/**
 * dsh-vps-hub — dynamic-plugin Host half (shell-service based).
 *
 * This file is the Host half used with `cordis_define` when you want the
 * Settings-page UI without installing the package. It registers the eight
 * model tools AND the Package-private RPC handlers the Settings page calls.
 *
 * Verified end-to-end: import → add → list → test → exec → upload → download.
 *
 * Usage (inside a DSH session with dynamic-plugin support):
 *   1. Call cordis_define; in code.host write:
 *        return {
 *          name: 'vps-hub',
 *          apply: <the body of apply() below — i.e. this file without the
 *                 "export function apply(ctx) {" line and its closing "}">
 *        }
 *   2. In code.client do the same with examples/dynamic-plugin/client.js.
 *   3. cordis_run the package and approve the client half.
 *   4. Settings → VPS Hub — and the eight vps_* tools appear in the session.
 *
 * This exact logic was verified end-to-end in a live DSH session (discover →
 * connect → add → delete → alias prefill), including the lossless-JSON and
 * heredoc fixes.
 *
 * Data: ~/.dsh/vpshub-targets.json (Orca-style ledger). Keys: path refs only.
 */
export function apply(ctx) {
  const shell = ctx.get('shell')
  if (shell === undefined) return

  const DATA_FILE = '"$HOME/.dsh/vpshub-targets.json"'
  const MAX_OUTPUT = 100000
  let homeCache = null
  const out = (o) => (o && typeof o.text === 'string' ? o.text : '')

  // Recursively normalize for lossless JSON (undefined → null).
  function clean(v) {
    if (v === undefined) return null
    if (Array.isArray(v)) return v.map(clean)
    if (v && typeof v === 'object') {
      const o = {}
      for (const k of Object.keys(v)) o[k] = clean(v[k])
      return o
    }
    return v
  }

  async function getHome() {
    if (homeCache === null) {
      const r = await shell.run(shell.resolve({ command: 'echo "$HOME"' }))
      homeCache = out(r.stdout).trim() || '/root'
    }
    return homeCache
  }

  async function loadData() {
    const r = await shell.run(shell.resolve({ command: `cat ${DATA_FILE} 2>/dev/null || echo __VPS_EMPTY__` }))
    const text = out(r.stdout).trim()
    if (text === '__VPS_EMPTY__' || text === '') {
      return { version: 1, targets: [], removedTargets: [], deletedConfigAliases: [] }
    }
    try { return JSON.parse(text) } catch { return { version: 1, targets: [], removedTargets: [], deletedConfigAliases: [] } }
  }

  async function saveData(data) {
    const json = JSON.stringify(data, null, 2)
    // The heredoc terminator must sit alone on its own line.
    const cmd = `mkdir -p "$HOME/.dsh" && cat > ${DATA_FILE} <<'VPSJSON'\n${json}\nVPSJSON`
    const r = await shell.run(shell.resolve({ command: cmd }))
    if (r.exitCode !== 0) throw new Error('cannot write ledger: ' + out(r.stderr).slice(0, 500))
  }

  function newId() {
    return 'vps-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  }

  function quoteSh(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'"
  }

  function truncate(s, n) {
    if (!s) return ''
    s = String(s)
    return s.length > n ? s.slice(0, n) + `\n... [truncated, ${s.length} chars total]` : s
  }

  // ── ~/.ssh/config parsing (Include expansion, first-match-wins) ──────────

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
      const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
      return re.test(alias)
    } catch { return false }
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

  async function readConfigText(path, depth, seen) {
    if (depth > 5 || seen.has(path)) return ''
    seen.add(path)
    const r = await shell.run(shell.resolve({ command: `cat ${quoteSh(path)} 2>/dev/null` }))
    const text = out(r.stdout)
    const outLines = []
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      const m = line.match(/^Include\s+(.*)$/i)
      if (m) {
        for (const pat of m[1].trim().split(/\s+/)) {
          let abs = pat
          if (pat.startsWith('~')) abs = (await getHome()) + pat.slice(1)
          else if (!pat.startsWith('/')) abs = path.replace(/\/[^/]*$/, '/') + pat
          const g = await shell.run(shell.resolve({ command: `ls ${quoteSh(abs)} 2>/dev/null` }))
          for (const f of out(g.stdout).split(/\r?\n/).filter(Boolean)) {
            outLines.push(await readConfigText(f, depth + 1, seen))
          }
        }
      } else {
        outLines.push(raw)
      }
    }
    return outLines.join('\n')
  }

  async function listConfigCandidates() {
    const cfgPath = (await getHome()) + '/.ssh/config'
    const text = await readConfigText(cfgPath, 0, new Set())
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

  // ── ssh command construction ─────────────────────────────────────────────

  function sshBaseOpts(t) {
    const opts = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new']
    // identityFile is passed unquoted so local bash expands ~; key CONTENT never appears.
    if (t.identityFile) opts.push('-o', 'IdentitiesOnly=yes', '-i', t.identityFile)
    if (t.port && t.port !== 22) opts.push('-p', String(t.port))
    if (t.jumpHost) opts.push('-J', t.jumpHost)
    if (t.proxyCommand) opts.push('-o', 'ProxyCommand=' + t.proxyCommand)
    return opts
  }

  function sshDest(t) {
    return (t.username ? t.username + '@' : '') + t.host
  }

  function sshCmd(t, remoteCommand) {
    return ['ssh', ...sshBaseOpts(t), sshDest(t), quoteSh(remoteCommand)].join(' ')
  }

  function scpCmd(t, localPath, remotePath, download) {
    const opts = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new']
    if (t.identityFile) opts.push('-o', 'IdentitiesOnly=yes', '-i', t.identityFile)
    if (t.port && t.port !== 22) opts.push('-P', String(t.port))
    const dest = sshDest(t)
    const src = download ? dest + ':' + quoteSh(remotePath) : quoteSh(localPath)
    const dst = download ? quoteSh(localPath) : dest + ':' + quoteSh(remotePath)
    return ['scp', ...opts, src, dst].join(' ')
  }

  // ── Settings-page RPC (Client → Host) ────────────────────────────────────

  const safe = (fn) => async (args) => {
    try { return clean(await fn(args)) } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }

  harness.handle('vps.list', safe(async (args) => {
    const data = await loadData()
    let targets = data.targets || []
    if (args && args.withStatus) {
      for (const t of targets) {
        const start = Date.now()
        const r = await shell.run(shell.resolve({ command: sshCmd(t, 'true'), timeoutMs: 10000 }))
        t.status = r.exitCode === 0 ? 'online' : 'offline'
        t.latencyMs = Date.now() - start
      }
    }
    return { targets }
  }))

  harness.handle('vps.candidates', safe(async () => {
    const data = await loadData()
    const candidates = await listConfigCandidates()
    const existing = new Map((data.targets || []).map((t) => [t.configHost, t]))
    for (const c of candidates) c.alreadyInLedger = existing.has(c.alias)
    return { candidates }
  }))

  harness.handle('vps.add', safe(async (args) => {
    const data = await loadData()
    let t = {}
    if (args.alias) {
      const candidates = await listConfigCandidates()
      const c = candidates.find((x) => x.alias === args.alias)
      if (!c) throw new Error(`alias ${args.alias} not in ~/.ssh/config`)
      t = { configHost: c.alias, host: c.hostname, port: c.port, username: c.username, identityFile: c.identityFile, jumpHost: c.proxyJump, proxyCommand: c.proxyCommand, source: 'ssh-config' }
      const dup = (data.targets || []).find((x) => x.configHost === c.alias)
      if (dup) throw new Error(`alias ${c.alias} already in ledger (id=${dup.id})`)
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
      const r = await shell.run(shell.resolve({ command: sshCmd(target, 'true'), timeoutMs: 15000 }))
      target.lastSeenAt = r.exitCode === 0 ? Date.now() : undefined
      target.testResult = r.exitCode === 0 ? 'ok' : 'failed: ' + truncate(out(r.stderr) || out(r.stdout), 300)
    }
    if (target.configHost) {
      data.deletedConfigAliases = (data.deletedConfigAliases || []).filter((a) => a !== target.configHost)
    }
    data.targets = data.targets || []
    data.targets.push(target)
    await saveData(data)
    return { id: target.id, label: target.label, testResult: target.testResult }
  }))

  harness.handle('vps.remove', safe(async (args) => {
    const data = await loadData()
    const idx = (data.targets || []).findIndex((t) => t.id === args.id)
    if (idx < 0) throw new Error(`target ${args.id} not found`)
    const t = data.targets[idx]
    data.targets.splice(idx, 1)
    data.removedTargets = data.removedTargets || []
    data.removedTargets.push({ oldTargetId: t.id, configHost: t.configHost, host: t.host, port: t.port, username: t.username, label: t.label, removedAt: Date.now() })
    if (t.configHost) data.deletedConfigAliases = [...new Set([...(data.deletedConfigAliases || []), t.configHost])]
    await saveData(data)
    return { removed: t.id, label: t.label }
  }))

  harness.handle('vps.test', safe(async (args) => {
    const data = await loadData()
    const t = (data.targets || []).find((x) => x.id === args.id)
    if (!t) throw new Error(`target ${args.id} not found`)
    const start = Date.now()
    const r = await shell.run(shell.resolve({ command: sshCmd(t, 'true'), timeoutMs: 15000 }))
    const ms = Date.now() - start
    if (r.exitCode === 0) {
      t.lastSeenAt = Date.now()
      await saveData(data)
      return { ok: true, ms, host: t.host }
    }
    return { ok: false, ms, host: t.host, error: truncate(out(r.stderr) || out(r.stdout), 500) }
  }))

  // ── model tools ──────────────────────────────────────────────────────────

  const OUTPUT = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }

  const tools = [
    {
      name: 'vps_list',
      description: 'List all servers in the VPS Hub ledger (no key content). Filter by tag or any field text; optionally attach an online-status check (slower). Returns id/label/host/port/user/identity-file/source/tags/note/lastSeenAt.',
      parameters: {
        query: { type: 'string', description: 'Optional: filter by tag or any field text' },
        withStatus: { type: 'boolean', description: 'Optional: probe connectivity per server and attach status + latency (a few seconds each)' },
      },
      async execute(args) {
        const data = await loadData()
        let targets = data.targets || []
        if (args.query) {
          const q = String(args.query).toLowerCase()
          targets = targets.filter((t) => [t.label, t.host, t.username, t.configHost, (t.tags || []).join(' '), t.note].join(' ').toLowerCase().includes(q))
        }
        if (args.withStatus) {
          for (const t of targets) {
            const start = Date.now()
            const r = await shell.run(shell.resolve({ command: sshCmd(t, 'true'), timeoutMs: 10000 }))
            t.status = r.exitCode === 0 ? 'online' : 'offline'
            t.latencyMs = Date.now() - start
          }
        }
        return { count: targets.length, targets }
      },
    },
    {
      name: 'vps_import_ssh_config',
      description: 'Scan ~/.ssh/config (Include-expanded) and list all candidate hosts with alias/hostname/port/user/identity-file, marking which are already in the ledger. Candidates contain no key content.',
      parameters: {},
      async execute() {
        const data = await loadData()
        const candidates = await listConfigCandidates()
        const existing = new Map((data.targets || []).map((t) => [t.configHost, t]))
        for (const c of candidates) c.alreadyInLedger = existing.has(c.alias)
        return { total: candidates.length, candidates }
      },
    },
    {
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
      async execute(args) {
        const data = await loadData()
        let t = {}
        if (args.alias) {
          const candidates = await listConfigCandidates()
          const c = candidates.find((x) => x.alias === args.alias)
          if (!c) throw new Error(`alias ${args.alias} not in ~/.ssh/config — run vps_import_ssh_config first`)
          t = { configHost: c.alias, host: c.hostname, port: c.port, username: c.username, identityFile: c.identityFile, jumpHost: c.proxyJump, proxyCommand: c.proxyCommand, source: 'ssh-config' }
          const dup = (data.targets || []).find((x) => x.configHost === c.alias)
          if (dup) throw new Error(`alias ${args.alias} already in ledger (id=${dup.id})`)
        } else {
          if (!args.host) throw new Error('host or alias is required')
          t = { host: String(args.host), port: args.port || 22, username: args.username, identityFile: args.identityFile, source: 'manual' }
        }
        if (args.label) t.label = String(args.label)
        if (args.tags) t.tags = args.tags.map(String)
        if (args.note) t.note = String(args.note)
        const target = { id: newId(), createdAt: Date.now(), updatedAt: Date.now(), ...t }
        target.label = target.label || (target.configHost || target.host)
        if (args.test) {
          const r = await shell.run(shell.resolve({ command: sshCmd(target, 'true'), timeoutMs: 15000 }))
          target.lastSeenAt = r.exitCode === 0 ? Date.now() : undefined
          target.testResult = r.exitCode === 0 ? 'ok' : 'failed: ' + truncate(out(r.stderr) || out(r.stdout), 300)
        }
        if (target.configHost) {
          data.deletedConfigAliases = (data.deletedConfigAliases || []).filter((a) => a !== target.configHost)
        }
        data.targets = data.targets || []
        data.targets.push(target)
        await saveData(data)
        return { id: target.id, label: target.label, testResult: target.testResult }
      },
    },
    {
      name: 'vps_remove',
      description: 'Remove a server from the ledger. Keeps a tombstone (and suppresses the config alias from re-import) so the host can be re-added cleanly later.',
      parameters: { id: { type: 'string', required: true, description: 'Target id from vps_list' } },
      async execute(args) {
        const data = await loadData()
        const idx = (data.targets || []).findIndex((t) => t.id === args.id)
        if (idx < 0) throw new Error(`target ${args.id} not found`)
        const t = data.targets[idx]
        data.targets.splice(idx, 1)
        data.removedTargets = data.removedTargets || []
        data.removedTargets.push({ oldTargetId: t.id, configHost: t.configHost, host: t.host, port: t.port, username: t.username, label: t.label, removedAt: Date.now() })
        if (t.configHost) data.deletedConfigAliases = [...new Set([...(data.deletedConfigAliases || []), t.configHost])]
        await saveData(data)
        return { removed: t.id, label: t.label }
      },
    },
    {
      name: 'vps_test',
      description: 'Test SSH connectivity to a server (non-interactive, 8s connect timeout). Returns online status and latency.',
      parameters: { id: { type: 'string', required: true, description: 'Target id' } },
      async execute(args) {
        const data = await loadData()
        const t = (data.targets || []).find((x) => x.id === args.id)
        if (!t) throw new Error(`target ${args.id} not found`)
        const start = Date.now()
        const r = await shell.run(shell.resolve({ command: sshCmd(t, 'true'), timeoutMs: 15000 }))
        const ms = Date.now() - start
        if (r.exitCode === 0) {
          t.lastSeenAt = Date.now()
          await saveData(data)
          return { ok: true, ms, host: t.host }
        }
        return { ok: false, ms, host: t.host, error: truncate(out(r.stderr) || out(r.stdout), 500) }
      },
    },
    {
      name: 'vps_exec',
      description: 'Execute one shell command on a server (non-interactive, 8s connect timeout). Returns exit code, stdout, stderr (output truncated to 100KB). For deploys, inspections, log reads, and maintenance.',
      parameters: {
        id: { type: 'string', required: true, description: 'Target id' },
        command: { type: 'string', required: true, description: 'Remote shell command, e.g. df -h' },
        timeoutMs: { type: 'number', description: 'Optional execution timeout, default 60000' },
      },
      async execute(args) {
        const data = await loadData()
        const t = (data.targets || []).find((x) => x.id === args.id)
        if (!t) throw new Error(`target ${args.id} not found`)
        const r = await shell.run(shell.resolve({ command: sshCmd(t, args.command), timeoutMs: args.timeoutMs || 60000 }))
        t.lastSeenAt = Date.now()
        await saveData(data)
        return { ok: r.exitCode === 0, exitCode: r.exitCode, stdout: truncate(out(r.stdout), MAX_OUTPUT), stderr: truncate(out(r.stderr), MAX_OUTPUT) }
      },
    },
    {
      name: 'vps_upload',
      description: 'Upload a local file to a server with scp (non-interactive).',
      parameters: {
        id: { type: 'string', required: true, description: 'Target id' },
        localPath: { type: 'string', required: true, description: 'Local file path' },
        remotePath: { type: 'string', required: true, description: 'Remote path, e.g. /root/app.tar.gz' },
      },
      async execute(args) {
        const data = await loadData()
        const t = (data.targets || []).find((x) => x.id === args.id)
        if (!t) throw new Error(`target ${args.id} not found`)
        const r = await shell.run(shell.resolve({ command: scpCmd(t, args.localPath, args.remotePath, false), timeoutMs: 120000 }))
        if (r.exitCode !== 0) throw new Error('upload failed: ' + truncate(out(r.stderr), 500))
        return { ok: true, to: `${t.host}:${args.remotePath}` }
      },
    },
    {
      name: 'vps_download',
      description: 'Download a file from a server with scp (non-interactive).',
      parameters: {
        id: { type: 'string', required: true, description: 'Target id' },
        remotePath: { type: 'string', required: true, description: 'Remote path' },
        localPath: { type: 'string', required: true, description: 'Local destination path' },
      },
      async execute(args) {
        const data = await loadData()
        const t = (data.targets || []).find((x) => x.id === args.id)
        if (!t) throw new Error(`target ${args.id} not found`)
        const r = await shell.run(shell.resolve({ command: scpCmd(t, args.localPath, args.remotePath, true), timeoutMs: 120000 }))
        if (r.exitCode !== 0) throw new Error('download failed: ' + truncate(out(r.stderr), 500))
        return { ok: true, from: `${t.host}:${args.remotePath}` }
      },
    },
  ]

  for (const def of tools) {
    harness.registerTool(ctx, harness.defineTool({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      output: OUTPUT,
      async execute(args) {
        try {
          return await def.execute(args)
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
    }))
  }
}
