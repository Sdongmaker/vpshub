# dsh-vps-hub

[![npm version](https://img.shields.io/npm/v/dsh-vps-hub)](https://www.npmjs.com/package/dsh-vps-hub) [![license](https://img.shields.io/npm/l/dsh-vps-hub)](LICENSE)

**VPS Hub for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** — keep a local ledger of your cloud-server SSH targets and let agents **discover, test, execute on, and transfer files to** them, with an optional **Settings-page UI**, modeled after [Orca](https://github.com/stablyai/orca)'s SSH remote-host management.

| | |
|---|---|
| **Agent tools** | `vps_list` `vps_import_ssh_config` `vps_add` `vps_remove` `vps_test` `vps_exec` `vps_upload` `vps_download` |
| **Settings UI** | optional — Settings → "VPS Hub" page (server cards, test-connect, add form with `~/.ssh/config` alias prefill, remove) |
| **Storage** | one JSON ledger, Orca-style: targets (`source: ssh-config \| manual`), removal tombstones, deleted-alias suppression |
| **Auth** | key path · pasted key content (saved privately to `~/.dsh/keys`, 0600) · password (memory-only, Orca-style) |
| **Proxy** | ProxyJump and ProxyCommand on every server |

---

## Why

- **Agent-discoverable**: `vps_list` / `vps_import_ssh_config` let the agent find your servers without re-typing connection details, and `vps_exec` / `vps_upload` / `vps_download` let it operate them (deploys, inspections, log reads, file transfer).
- **Orca-style management**: the Settings page mirrors Orca's `Settings → SSH` — pick a host from `~/.ssh/config` (Include-expanded, `*`/`?` wildcards, `Host *` fallback) and it prefills the form; saved hosts show an "in ledger" mark.
- **Zero new daemons**: execution shells out to the system `ssh` / `scp` binaries. The packaged plugin uses `execFile` (no shell interpolation); the dynamic-plugin variant uses the DSH shell service.
- **Keys stay local**: the ledger stores only `identityFile` *path references*; pasted key CONTENT is written to a private file under `~/.dsh/keys` (mode 0600) and referenced by path — never stored in the ledger.
- **Passwords never touch disk** (Orca-style): passwords live in process memory for the plugin's lifetime and are handed to `ssh` through the `SSH_ASKPASS` protocol via the child environment — never in argv, never in a file, gone on restart.
- **Proxy support**: every server can carry a ProxyJump (`-J`) and/or a ProxyCommand, covering bastion hosts and SOCKS/HTTP proxies.

---

## Install

> 📖 Full **Chinese step-by-step guide** (verification output, FAQ, upgrade/uninstall): [docs/INSTALL.zh.md](https://github.com/Sdongmaker/vpshub/blob/main/docs/INSTALL.zh.md)

### Prerequisites

- macOS / Linux with system `ssh` and `scp` on `PATH` (Windows not supported yet)
- DSH 0.1.0-rc.x with the **web** profile
- A writable DSH profile directory (e.g. `~/.dsh/profiles/web`)
- SSH access to at least one server (key-based, or a password you can provide per session)

### Option A — npm package (permanent, agent tools)

**Step 1 — install into your DSH profile:**

```bash
cd ~/.dsh/profiles/web          # your profile directory
npm install dsh-vps-hub         # or: pnpm add dsh-vps-hub
```

**Step 2 — mount it in `cordis.patch.yml`** (the profile root, e.g. `~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- insert:
    - id: vps-hub
      name: 'dsh-vps-hub'
      # optional config (all fields have sensible defaults):
      config:
        # dataFile: '~/.dsh/vpshub-targets.json'   # ledger path override
        # maxOutputBytes: 100000                    # per-command output cap (bytes)
        # connectTimeoutSec: 8                      # ssh/scp connect timeout (s)
```

**Step 3 — restart (or HMR-reload) the profile**, then verify (see [Verification](#verification)).

> **Why `cordis.patch.yml` and not `cordis.yml`?** The profile root `cordis.yml` is
> an empty list composed as patches — edit the patch file, never the root.

**Configuration:**

| Field | Type | Default | Description |
|---|---|---|---|
| `dataFile` | string | `~/.dsh/vpshub-targets.json` | Ledger JSON path override |
| `maxOutputBytes` | number | `100000` | Per-command output cap returned to the model |
| `connectTimeoutSec` | number | `8` | ssh/scp connect timeout in seconds |

**Upgrade / uninstall:**

```bash
npm update dsh-vps-hub                # upgrade
npm install dsh-vps-hub@latest        # upgrade (explicit)
npm uninstall dsh-vps-hub             # uninstall — also remove the row from cordis.patch.yml
```

### Option B — dynamic plugin (session-scoped, adds the Settings-page UI)

If you want the **Settings → VPS Hub page** without installing the package
(or to try the UI first), load the verified example as a session dynamic
Cordis Plugin:

1. Open `examples/dynamic-plugin/` — `host.js` (tools + RPC) and `client.js` (Settings UI).
2. Call `cordis_define`: paste `apply()`'s body from `host.js` into `code.host`
   as `return { name: 'vps-hub', apply: <body> }`, and the body from `client.js`
   into `code.client` as `return { name: 'vps-hub-ui', apply: <body> }`.
3. `cordis_run` and approve the client half (one-time UI approval).
4. Open **Settings → VPS Hub** — and the eight tools are live in the session.

Dynamic plugins are session-scoped: they vanish when DSH restarts (the ledger
file persists). Full instructions: [`examples/dynamic-plugin/README.md`](https://github.com/Sdongmaker/vpshub/blob/main/examples/dynamic-plugin/README.md).

### Verification

After Option A, confirm the install in any of these ways:

```bash
# 1) the agent sees the tools — in a session ask: "list my servers"
# 2) repo smoke test against your real ledger (needs the repo):
node examples/smoke.mjs
# 3) the ledger file appears after the first vps_add / vps_test:
ls -l ~/.dsh/vpshub-targets.json
```

Expected: `vps_list` returns your servers (or an empty list), `vps_exec` runs a
read-only command like `hostname` on a server, and Settings shows the ledger
(Option B).

### Requirements

- macOS / Linux (system `ssh`, `scp` on `PATH`; Windows is not supported yet)
- DSH 0.1.0-rc.x with the web profile
- Key-based auth, or password provided per session (memory-only)

## Quick start

Once installed, just ask your agent:

| You say | The agent runs |
|---|---|
| "list my servers" | `vps_list` |
| "import my ssh config" | `vps_import_ssh_config` |
| "add the `hk-prod` alias from my ssh config" | `vps_add { alias: "hk-prod" }` |
| "is the aliyun box up?" | `vps_test { id }` |
| "run `df -h` on the aliyun box" | `vps_exec { id, command: "df -h" }` |
| "upload app.tar.gz to the OVH box" | `vps_upload { id, localPath, remotePath }` |
| "add my VPS with this key I'm pasting" | `vps_add { host, username, identityKeyContent: "-----BEGIN …" }` |
| "test the box using password …" | `vps_test { id, password }` (or set once via `vps_add`; kept in memory) |

## Tools

| Tool | Purpose |
|---|---|
| `vps_list` | List ledger servers (no key content); filter by tag/text; optional `withStatus` connectivity probe (latency per server) |
| `vps_import_ssh_config` | Scan `~/.ssh/config` (Include-expanded) and list importable hosts with `alreadyInLedger` marks |
| `vps_add` | Add a server from a config alias or manual fields (host/port/user/key path/pasted key content/password/jump host/proxy command); optional pre-save `test` |
| `vps_remove` | Remove a server, keeping a tombstone + deleted-alias suppression for clean re-add |
| `vps_test` | Non-interactive connectivity check with latency (optional `password`); updates `lastSeenAt` |
| `vps_exec` | Run one shell command on a server (optional `password`; output truncated to 100KB by default) |
| `vps_upload` / `vps_download` | scp file transfer both ways (optional `password`) |

## Storage

One JSON document — default `$DSH_HOME` / `~/.dsh/vpshub-targets.json`
(`dataFile` config overrides):

```jsonc
{
  "version": 1,
  "targets": [
    {
      "id": "vps-1786641416471-a1b2c3",
      "label": "aliyun-prod",
      "configHost": "orca",                 // alias when imported from ~/.ssh/config
      "host": "1.2.3.4",
      "port": 22,
      "username": "root",
      "identityFile": "~/.ssh/id_ed25519",  // path only
      "source": "ssh-config" | "manual",    // ssh-config targets re-sync on import; manual never overwritten
      "tags": ["aliyun", "prod"],
      "note": "...",
      "lastSeenAt": 1786641416471,
      "createdAt": 1786641416471,
      "updatedAt": 1786641416471
    }
  ],
  "removedTargets": [],        // tombstones for clean re-add
  "deletedConfigAliases": []   // aliases suppressed from re-import after removal
}
```

This mirrors Orca's SSH-target model (`orca-data.json`): `ssh-config`-sourced
targets are refreshed on each import, `manual` targets are never overwritten,
and removing a host records a tombstone plus alias suppression so re-adding
stays clean.

## Security notes

- Key-auth runs fully non-interactive (`BatchMode=yes`); password-auth runs with
  `NumberOfPasswordPrompts=1` and `SSH_ASKPASS_REQUIRE=force`. Host-key policy defaults
  to `accept-new`; enable `strictHostKeyChecking: true` in the plugin config for strict
  `known_hosts` (MITM hardening).
- **`proxyCommand` is executed by `ssh` through the LOCAL shell by design** — values are
  restricted to a whitelist character set plus `%h`/`%p` placeholders; treat it as trusted code.
- **Passwords ride the child environment** (`VPS_PASSWORD` via SSH_ASKPASS): same-user
  processes on POSIX can read `/proc/<pid>/environ` — treat passwords as visible to
  anything running as your user. Password mode is POSIX-only (Windows fails with a clear
  message).
- Passwords are memory-only and never written to disk; the askpass bridge script
  lives at `~/.dsh/.vpshub-askpass.sh` (0700) and reads the password from the
  child environment. Restarting DSH clears all cached passwords.
- **Pasted keys are a trade-off**: `identityKeyContent` passes through the model
  call (tool argument), so prefer key *paths* when possible. Saved content lives
  at `~/.dsh/keys/<id>.key` (0600, directory 0700) and is never echoed back.
- The packaged plugin passes the remote command as a **single argv element to
  `execFile`** — remote commands cannot inject local shell syntax.
- The ledger file is written atomically with mode `0600`. Keep your
  `identityFile`s `0600` as usual.
- Remote execution is a real power tool: the model can run arbitrary commands
  on servers you add. Use DSH's permission/approval layer if you want a
  confirmation gate.

## Project layout

```
dsh-vps-hub/
├── docs/
│   ├── INSTALL.zh.md        # full Chinese install guide
│   └── PLUGIN-DEV-GUIDE.md   # plugin dev → test → publish playbook (from this project's real experience)
├── src/
│   └── index.js              # packaged host plugin (execFile-based)
├── examples/
│   ├── cordis.patch.yml      # profile mount example (Option A)
│   ├── dynamic-plugin/       # verified session plugin: Settings UI + tools (Option B)
│   │   ├── README.md
│   │   ├── host.js
│   │   └── client.js
│   └── smoke.mjs             # smoke test against the real ledger (node smoke.mjs)
├── package.json
├── README.md / README.zh.md
└── LICENSE
```

## Development & testing

```bash
npm install          # dev deps (zod, @deepseek-ai/dsh-tools)
node --check src/index.js
node examples/smoke.mjs   # registers tools on a fake ctx, lists the real
                          # ledger, and runs a read-only vps_exec
```

The core logic was verified end-to-end in a live DSH session against real
servers: import → add → list+status → test → exec → upload → download →
remove, plus the Settings-page UI loop (discover → test-connect → add →
delete → alias prefill).

## Security

See [SECURITY.md](SECURITY.md) for the security model, hardening tips, and how to report a vulnerability.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

## Known issue history

- **v0.1.0 → v0.1.1 (breaking load fix)**: v0.1.0 read `ctx.config`, which the Cordis Guard rejects — the loader entry failed and took the whole Web process down. v0.1.1 uses the official `apply(ctx, config)` signature. If you are on v0.1.0, upgrade: `npm install dsh-vps-hub@latest`.
- **v0.1.1 → v0.1.2 (YAML `null` config fix)**: a bare `config:` with only comments parses to `null` in YAML; the zod `Config` now tolerates `null` (`.nullish()`), and docs use `config: {}`.

## Limitations

- Windows not supported (requires system `ssh`/`scp`).
- Password auth is supported via `SSH_ASKPASS`, but passwords are memory-only:
  re-enter after every DSH restart (Orca behaves the same way).
- The Settings-page UI ships as a dynamic-plugin example, not inside the npm
  package yet — a packaged client half needs the Typert Remote decorator
  pipeline (TypeScript build) and is planned for a later release.
- `~/.ssh/config` parsing supports `Include`, `*`/`?` wildcards and `Host *`
  fallback; token-level OpenSSH semantics beyond that (e.g. `Match`,
  hostname re-resolution chains) are not implemented — the agent can still
  `vps_add` such hosts manually with explicit fields.

## License

MIT
