/**
 * dsh-vps-hub — manage your cloud-server SSH ledger from DeepSeek Harness.
 *
 * Storage mirrors Orca's SSH-target model: one JSON document holding targets
 * (`source: 'ssh-config' | 'manual'`), removal tombstones, and suppressed
 * config aliases. Private keys are never stored — only path references
 * (`identityFile`), and key contents never appear in tool output.
 *
 * Execution uses the system `ssh`/`scp` binaries via `execFile` (no shell
 * interpolation), non-interactively with `BatchMode=yes`.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-vps-hub'

export const inject = ['tools']

export const Config = z.object({
  /** Override the ledger JSON path (default: $DSH_HOME or ~/.dsh/vpshub-targets.json). */
  dataFile: z.string().optional(),
  /** Max bytes of command output returned to the model. */
  maxOutputBytes: z.number().int().positive().max(1048576).optional(),
  /** Connection timeout in seconds for ssh/scp. */
  connectTimeoutSec: z.number().int().positive().max(60).optional(),
})

const execFileAsync = promisify(execFile)

function dataFilePath(config) {
  if (config.dataFile) return path.resolve(expandHome(config.dataFile))
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'vpshub-targets.json')
}

function expandHome(p) {
  if (!p) return p
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

function newId() {
  return 'vps-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}

function truncate(s, n) {
  if (!s) return ''
  s = String(s)
  return s.length > n ? s.slice(0, n) + `\n... [truncated, ${s.length} chars total]` : s
}

/** Run a binary with an argv array; returns { exitCode, stdout, stderr }. */
async function run(bin, args, timeoutMs) {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    })
    return { exitCode: 0, stdout: stdout || '', stderr: stderr || '' }
  } catch (error) {
    return {
      exitCode: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout || '',
      stderr: error.stderr || String(error.message || error),
    }
  }
}

// ── ledger persistence ──────────────────────────────────────────────────────

function loadData(config) {
  const file = dataFilePath(config)
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && Array.isArray(parsed.targets)) return parsed
  } catch {
    /* missing or invalid → fresh ledger */
  }
  return { version: 1, targets: [], removedTargets: [], deletedConfigAliases: [] }
}

function saveData(config, data) {
  const file = dataFilePath(config)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

// ── ~/.ssh/config parsing (Include expansion, first-match-wins) ─────────────

function globToRegExp(pattern) {
  return new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
  )
}

function expandConfigGlob(pattern, baseDir) {
  const abs = pattern.startsWith('~') ? expandHome(pattern) : path.isAbsolute(pattern) ? pattern : path.join(baseDir, pattern)
  if (!/[*?]/.test(abs)) return fs.existsSync(abs) ? [abs] : []
  const dir = path.dirname(abs)
  const base = path.basename(abs)
  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const re = globToRegExp(base)
  return entries.filter((e) => re.test(e)).map((e) => path.join(dir, e))
}

function readConfigText(file, depth, seen) {
  if (depth > 5 || seen.has(file)) return ''
  seen.add(file)
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const m = line.match(/^Include\s+(.*)$/i)
    if (m) {
      for (const pat of m[1].trim().split(/\s+/)) {
        for (const f of expandConfigGlob(pat, path.dirname(file))) {
          out.push(readConfigText(f, depth + 1, seen))
        }
      }
    } else {
      out.push(raw)
    }
  }
  return out.join('\n')
}

function parseSshConfig(text) {
  const blocks = []
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const m = line.match(/^(\S+)\s+(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2]
    if (key === 'host') {
      current = { patterns: value.trim().split(/\s+/), fields: {} }
      blocks.push(current)
    } else if (current) {
      current.fields[key] = value
    }
  }
  return blocks
}

function patternMatches(pattern, alias) {
  if (pattern === '*') return true
  if (pattern === alias) return true
  try {
    return globToRegExp(pattern).test(alias)
  } catch {
    return false
  }
}

function resolveAlias(blocks, alias) {
  const fields = {}
  for (const b of blocks) {
    if (b.patterns.some((p) => patternMatches(p, alias))) {
      for (const [k, v] of Object.entries(b.fields)) {
        if (!(k in fields)) fields[k] = v
      }
    }
  }
  return fields
}

function firstToken(v) {
  if (!v) return undefined
  const t = v.trim().split(/\s+/)[0]
  return t === '~' ? undefined : t
}

function listConfigCandidates() {
  const cfgPath = path.join(os.homedir(), '.ssh', 'config')
  const text = readConfigText(cfgPath, 0, new Set())
  const blocks = parseSshConfig(text)
  const seen = new Set()
  const candidates = []
  for (const b of blocks) {
    for (const pattern of b.patterns) {
      if (pattern.includes('*') || pattern.includes('?') || seen.has(pattern)) continue
      seen.add(pattern)
      const fields = resolveAlias(blocks, pattern)
      candidates.push({
        alias: pattern,
        hostname: firstToken(fields.hostname) || pattern,
        port: fields.port ? parseInt(fields.port, 10) : 22,
        username: firstToken(fields.user) || undefined,
        identityFile: firstToken(fields.identityfile) || undefined,
        proxyJump: firstToken(fields.proxyjump) || undefined,
        proxyCommand: firstToken(fields.proxycommand) || undefined,
      })
    }
  }
  return candidates
}

// ── ssh/scp command construction ────────────────────────────────────────────

function sshBaseOpts(t, connectTimeoutSec) {
  const opts = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${connectTimeoutSec}`,
    '-o', 'StrictHostKeyChecking=accept-new',
  ]
  if (t.identityFile) opts.push('-o', 'IdentitiesOnly=yes', '-i', expandHome(t.identityFile))
  if (t.port && t.port !== 22) opts.push('-p', String(t.port))
  if (t.jumpHost) opts.push('-J', t.jumpHost)
  if (t.proxyCommand) opts.push('-o', `ProxyCommand=${t.proxyCommand}`)
  return opts
}

function sshDest(t) {
  return (t.username ? t.username + '@' : '') + t.host
}

function sshArgs(t, remoteCommand, connectTimeoutSec) {
  return [...sshBaseOpts(t, connectTimeoutSec), sshDest(t), remoteCommand]
}

function scpArgs(t, localPath, remotePath, download, connectTimeoutSec) {
  const opts = ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${connectTimeoutSec}`, '-o', 'StrictHostKeyChecking=accept-new']
  if (t.identityFile) opts.push('-o', 'IdentitiesOnly=yes', '-i', expandHome(t.identityFile))
  if (t.port && t.port !== 22) opts.push('-P', String(t.port))
  const dest = sshDest(t)
  const src = download ? `${dest}:${remotePath}` : localPath
  const dst = download ? localPath : `${dest}:${remotePath}`
  return [...opts, src, dst]
}

// ── tools ───────────────────────────────────────────────────────────────────

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function defineTools(ctx, config) {
  const connectTimeoutSec = config.connectTimeoutSec || 8
  const maxOutputBytes = config.maxOutputBytes || 100000

  const findTarget = (data, id) => {
    const t = (data.targets || []).find((x) => x.id === id)
    if (!t) throw new Error(`target ${id} not found — run vps_list first`)
    return t
  }

  return [
    defineTool({
      name: 'vps_list',
      description: 'List all servers in the VPS Hub ledger (no key content). Filter by tag or any text; optionally attach an online-status check (slower). Returns id/label/host/port/user/identity-file/source/tags/note/lastSeenAt.',
      parameters: {
        query: { type: 'string', description: 'Optional: filter by tag or any field text' },
        withStatus: { type: 'boolean', description: 'Optional: probe connectivity per server and attach status + latency (a few seconds each)' },
      },
      output: OUTPUT,
      async execute(args) {
        const data = loadData(config)
        let targets = data.targets || []
        if (args.query) {
          const q = String(args.query).toLowerCase()
          targets = targets.filter((t) => [t.label, t.host, t.username, t.configHost, (t.tags || []).join(' '), t.note].join(' ').toLowerCase().includes(q))
        }
        if (args.withStatus) {
          for (const t of targets) {
            const start = Date.now()
            const r = await run('ssh', sshArgs(t, 'true', connectTimeoutSec), 10000)
            t.status = r.exitCode === 0 ? 'online' : 'offline'
            t.latencyMs = Date.now() - start
          }
        }
        return { count: targets.length, targets }
      },
    }),

    defineTool({
      name: 'vps_import_ssh_config',
      description: 'Scan ~/.ssh/config (Include-expanded) and list all candidate hosts with alias/hostname/port/user/identity-file, marking which are already in the ledger. Candidates contain no key content.',
      parameters: {},
      output: OUTPUT,
      async execute() {
        const data = loadData(config)
        const candidates = listConfigCandidates()
        const existing = new Map((data.targets || []).map((t) => [t.configHost, t]))
        for (const c of candidates) {
          c.alreadyInLedger = existing.has(c.alias)
        }
        return { total: candidates.length, candidates }
      },
    }),

    defineTool({
      name: 'vps_add',
      description: 'Add a server to the VPS Hub ledger. Provide alias (import from ~/.ssh/config) or full manual fields; optionally test connectivity before saving. Keys are accepted as file-path references (identityFile) only — never key contents.',
      parameters: {
        label: { type: 'string', description: 'Display name, e.g. hk-prod' },
        alias: { type: 'string', description: 'Optional: Host alias from ~/.ssh/config; prefills other fields' },
        host: { type: 'string', description: 'Hostname or IP (required when alias is absent)' },
        port: { type: 'number', description: 'SSH port, default 22' },
        username: { type: 'string', description: 'Login user' },
        identityFile: { type: 'string', description: 'Private key file path, e.g. ~/.ssh/id_ed25519' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for discovery' },
        note: { type: 'string', description: 'Optional note' },
        test: { type: 'boolean', description: 'Test connectivity before saving' },
      },
      output: OUTPUT,
      async execute(args) {
        const data = loadData(config)
        let t = {}
        if (args.alias) {
          const candidates = listConfigCandidates()
          const c = candidates.find((x) => x.alias === args.alias)
          if (!c) throw new Error(`alias ${args.alias} not found in ~/.ssh/config — run vps_import_ssh_config first`)
          t = { configHost: c.alias, host: c.hostname, port: c.port, username: c.username, identityFile: c.identityFile, jumpHost: c.proxyJump, proxyCommand: c.proxyCommand, source: 'ssh-config' }
          const dup = (data.targets || []).find((x) => x.configHost === c.alias)
          if (dup) throw new Error(`alias ${c.alias} is already in the ledger (id=${dup.id})`)
        } else {
          if (!args.host) throw new Error('host or alias is required')
          t = { host: String(args.host), port: args.port || 22, username: args.username, identityFile: args.identityFile, source: 'manual' }
        }
        if (args.label) t.label = String(args.label)
        if (args.tags) t.tags = args.tags.map(String)
        if (args.note) t.note = String(args.note)
        const target = { id: newId(), createdAt: Date.now(), updatedAt: Date.now(), ...t }
        target.label = target.label || target.configHost || target.host
        if (args.test) {
          const r = await run('ssh', sshArgs(target, 'true', connectTimeoutSec), 15000)
          target.lastSeenAt = r.exitCode === 0 ? Date.now() : undefined
          target.testResult = r.exitCode === 0 ? 'ok' : 'failed: ' + truncate(r.stderr || r.stdout, 300)
        }
        if (target.configHost) {
          data.deletedConfigAliases = (data.deletedConfigAliases || []).filter((a) => a !== target.configHost)
        }
        data.targets = data.targets || []
        data.targets.push(target)
        saveData(config, data)
        return { id: target.id, label: target.label, testResult: target.testResult }
      },
    }),

    defineTool({
      name: 'vps_remove',
      description: 'Remove a server from the ledger. Keeps a tombstone (and suppresses the config alias from re-import) so the host can be re-added cleanly later.',
      parameters: { id: { type: 'string', required: true, description: 'Target id from vps_list' } },
      output: OUTPUT,
      async execute(args) {
        const data = loadData(config)
        const idx = (data.targets || []).findIndex((t) => t.id === args.id)
        if (idx < 0) throw new Error(`target ${args.id} not found`)
        const t = data.targets[idx]
        data.targets.splice(idx, 1)
        data.removedTargets = data.removedTargets || []
        data.removedTargets.push({ oldTargetId: t.id, configHost: t.configHost, host: t.host, port: t.port, username: t.username, label: t.label, removedAt: Date.now() })
        if (t.configHost) data.deletedConfigAliases = [...new Set([...(data.deletedConfigAliases || []), t.configHost])]
        saveData(config, data)
        return { removed: t.id, label: t.label }
      },
    }),

    defineTool({
      name: 'vps_test',
      description: 'Test SSH connectivity to a server (non-interactive, 8s connect timeout). Returns online status and latency.',
      parameters: { id: { type: 'string', required: true, description: 'Target id' } },
      output: OUTPUT,
      async execute(args) {
        const data = loadData(config)
        const t = findTarget(data, args.id)
        const start = Date.now()
        const r = await run('ssh', sshArgs(t, 'true', connectTimeoutSec), 15000)
        const ms = Date.now() - start
        if (r.exitCode === 0) {
          t.lastSeenAt = Date.now()
          saveData(config, data)
          return { ok: true, ms, host: t.host }
        }
        return { ok: false, ms, host: t.host, error: truncate(r.stderr || r.stdout, 500) }
      },
    }),

    defineTool({
      name: 'vps_exec',
      description: 'Execute one shell command on a server (non-interactive, 8s connect timeout). Returns exit code, stdout, stderr (output truncated to 100KB). For deploys, inspections, log reads, and maintenance.',
      parameters: {
        id: { type: 'string', required: true, description: 'Target id' },
        command: { type: 'string', required: true, description: 'Remote shell command, e.g. df -h' },
        timeoutMs: { type: 'number', description: 'Optional execution timeout, default 60000' },
      },
      output: OUTPUT,
      async execute(args) {
        const data = loadData(config)
        const t = findTarget(data, args.id)
        const r = await run('ssh', sshArgs(t, args.command, connectTimeoutSec), args.timeoutMs || 60000)
        t.lastSeenAt = Date.now()
        saveData(config, data)
        return { ok: r.exitCode === 0, exitCode: r.exitCode, stdout: truncate(r.stdout, maxOutputBytes), stderr: truncate(r.stderr, maxOutputBytes) }
      },
    }),

    defineTool({
      name: 'vps_upload',
      description: 'Upload a local file to a server with scp (non-interactive).',
      parameters: {
        id: { type: 'string', required: true, description: 'Target id' },
        localPath: { type: 'string', required: true, description: 'Local file path' },
        remotePath: { type: 'string', required: true, description: 'Remote path, e.g. /root/app.tar.gz' },
      },
      output: OUTPUT,
      async execute(args) {
        const data = loadData(config)
        const t = findTarget(data, args.id)
        const r = await run('scp', scpArgs(t, args.localPath, args.remotePath, false, connectTimeoutSec), 120000)
        if (r.exitCode !== 0) throw new Error('upload failed: ' + truncate(r.stderr, 500))
        return { ok: true, to: `${t.host}:${args.remotePath}` }
      },
    }),

    defineTool({
      name: 'vps_download',
      description: 'Download a file from a server with scp (non-interactive).',
      parameters: {
        id: { type: 'string', required: true, description: 'Target id' },
        remotePath: { type: 'string', required: true, description: 'Remote path' },
        localPath: { type: 'string', required: true, description: 'Local destination path' },
      },
      output: OUTPUT,
      async execute(args) {
        const data = loadData(config)
        const t = findTarget(data, args.id)
        const r = await run('scp', scpArgs(t, args.localPath, args.remotePath, true, connectTimeoutSec), 120000)
        if (r.exitCode !== 0) throw new Error('download failed: ' + truncate(r.stderr, 500))
        return { ok: true, from: `${t.host}:${args.remotePath}` }
      },
    }),
  ]
}

export function apply(ctx) {
  const config = ctx.config || {}
  for (const tool of defineTools(ctx, config)) {
    ctx.tools.register(tool)
  }
}
