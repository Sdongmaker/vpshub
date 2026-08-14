/**
 * dsh-vps-hub — dynamic-plugin Host half, **UI-only mode (RPC only)**.
 *
 * Use THIS file when the packaged plugin (npm `dsh-vps-hub`) is already
 * installed and provides the eight vps_* tools: this half registers ONLY the
 * five Settings-page RPC handlers (vps.list/candidates/add/remove/test) and
 * registers NO tools, so it coexists with the packaged plugin without tool
 * name conflicts. The Settings UI reads and writes the SAME ledger
 * (~/.dsh/vpshub-targets.json) the packaged plugin uses.
 *
 * Usage (inside a DSH session with dynamic-plugin support):
 *   1. Call cordis_define; in code.host write:
 *        return {
 *          name: 'vps-hub-ui-rpc',
 *          apply: <the body of apply() below — i.e. this file without the
 *                 "export function apply(ctx) {" line and its closing "}">
 *        }
 *   2. In code.client use examples/dynamic-plugin/client.js the same way
 *      (return { name: 'vps-hub-ui', apply: <body> }).
 *   3. cordis_run and approve the client half (one-time).
 *   4. Settings → VPS Hub — tools stay served by the installed package.
 */
export function apply(ctx) {
  const shell = ctx.get('shell')
  if (shell === undefined) return

  const DATA_FILE = '"$HOME/.dsh/vpshub-targets.json"'
  const KEYS_DIR = '"$HOME/.dsh/keys"'
  const ASKPASS_FILE = '"$HOME/.dsh/.vpshub-askpass.sh"'
  const MAX_OUTPUT = 100000
  let homeCache = null
  const passwordCache = new Map() // targetId → password (process memory only)
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

  /** Save pasted key CONTENT to a private file; returns the path to reference. */
  async function saveKeyContent(content, id) {
    await shell.run(shell.resolve({ command: `mkdir -p ${KEYS_DIR} && chmod 700 "$HOME/.dsh/keys" && cat > ${KEYS_DIR}/${id}.key <<'KEYEOF'\n${content}${content.endsWith('\n') ? '' : '\n'}KEYEOF && chmod 600 "$HOME/.dsh/keys/${id}.key"` }))
    return `~/.dsh/keys/${id}.key`
  }

  async function ensureAskpass() {
    const r = await shell.run(shell.resolve({ command: `cat ${ASKPASS_FILE} 2>/dev/null | head -1` }))
    if (out(r.stdout).trim() === '#!/bin/sh') return
    await shell.run(shell.resolve({ command: `cat > ${ASKPASS_FILE} <<'ASKEOF'\n#!/bin/sh\necho "$VPS_PASSWORD"\nASKEOF && chmod 700 "$HOME/.dsh/.vpshub-askpass.sh"` }))
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

  function sshBaseOpts(t, usePassword) {
    const opts = ['-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new']
    if (usePassword) {
      opts.push('-o', 'NumberOfPasswordPrompts=1')
    } else {
      opts.push('-o', 'BatchMode=yes')
    }
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

  function sshCmd(t, remoteCommand, usePassword) {
    return ['ssh', ...sshBaseOpts(t, usePassword), sshDest(t), quoteSh(remoteCommand)].join(' ')
  }

  function scpCmd(t, localPath, remotePath, download, usePassword) {
    const opts = ['-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new']
    if (usePassword) {
      opts.push('-o', 'NumberOfPasswordPrompts=1')
    } else {
      opts.push('-o', 'BatchMode=yes')
    }
    if (t.identityFile) opts.push('-o', 'IdentitiesOnly=yes', '-i', t.identityFile)
    if (t.port && t.port !== 22) opts.push('-P', String(t.port))
    const dest = sshDest(t)
    const src = download ? dest + ':' + quoteSh(remotePath) : quoteSh(localPath)
    const dst = download ? quoteSh(localPath) : dest + ':' + quoteSh(remotePath)
    return ['scp', ...opts, src, dst].join(' ')
  }

  /** Run ssh/scp; password flows through SSH_ASKPASS env (VPS_PASSWORD). */
  async function runRemote(command, timeoutMs, password) {
    if (password) {
      await ensureAskpass()
      const env = {
        SSH_ASKPASS: (await getHome()) + '/.dsh/.vpshub-askpass.sh',
        SSH_ASKPASS_REQUIRE: 'force',
        VPS_PASSWORD: password,
      }
      return shell.run(shell.resolve({ command, timeoutMs, env }))
    }
    return shell.run(shell.resolve({ command, timeoutMs }))
  }

  function resolvePassword(target, explicit) {
    if (explicit) return explicit
    return passwordCache.get(target.id) || undefined
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
        const pw = resolvePassword(t)
        const r = await runRemote(sshCmd(t, 'true', !!pw), 10000, pw)
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
      if (args.jumpHost) t.jumpHost = String(args.jumpHost)
      if (args.proxyCommand) t.proxyCommand = String(args.proxyCommand)
    }
    if (args.label) t.label = String(args.label)
    if (args.tags) t.tags = args.tags.map(String)
    if (args.note) t.note = String(args.note)
    const target = { id: newId(), createdAt: Date.now(), updatedAt: Date.now(), ...t }
    target.label = target.label || target.configHost || target.host
    validateTargetFields(target)

    // key CONTENT → private file, referenced by path; never in the ledger
    if (args.identityKeyContent) {
      target.identityFile = await saveKeyContent(String(args.identityKeyContent), target.id)
    }
    // password → memory only (Orca-style), never persisted
    if (args.password) {
      passwordCache.set(target.id, String(args.password))
    }

    if (args.test) {
      const pw = resolvePassword(target)
      const r = await runRemote(sshCmd(target, 'true', !!pw), 15000, pw)
      target.lastSeenAt = r.exitCode === 0 ? Date.now() : undefined
      target.testResult = r.exitCode === 0 ? 'ok' : 'failed: ' + truncate(out(r.stderr) || out(r.stdout), 300)
    }
    if (target.configHost) {
      data.deletedConfigAliases = (data.deletedConfigAliases || []).filter((a) => a !== target.configHost)
    }
    data.targets = data.targets || []
    data.targets.push(target)
    await saveData(data)
    return { id: target.id, label: target.label, testResult: target.testResult, auth: args.password ? 'password(memory)' : args.identityKeyContent ? 'key-file(saved)' : 'key-path' }
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
    passwordCache.delete(t.id)
    return { removed: t.id, label: t.label }
  }))

  harness.handle('vps.test', safe(async (args) => {
    const data = await loadData()
    const t = (data.targets || []).find((x) => x.id === args.id)
    if (!t) throw new Error(`target ${args.id} not found`)
    if (args.password) passwordCache.set(t.id, String(args.password))
    const pw = resolvePassword(t)
    const start = Date.now()
    const r = await runRemote(sshCmd(t, 'true', !!pw), 15000, pw)
    const ms = Date.now() - start
    if (r.exitCode === 0) {
      t.lastSeenAt = Date.now()
      await saveData(data)
      return { ok: true, ms, host: t.host }
    }
    return { ok: false, ms, host: t.host, error: truncate(out(r.stderr) || out(r.stdout), 500) }
  }))
}
