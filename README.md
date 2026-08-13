# dsh-vps-hub

VPS Hub plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): keep a local ledger of your cloud-server SSH targets and let agents **discover**, **test**, **execute on**, and **transfer files to** them — the way [Orca](https://github.com/stablyai/orca) manages SSH remote hosts, but built for DSH's agent plane.

## Why

- **Agent-discoverable**: `vps_list` / `vps_import_ssh_config` let the agent find your servers without you re-typing connection details.
- **Zero new daemons**: execution shells out to the system `ssh` / `scp` binaries (`execFile`, no shell interpolation), so there is no relay daemon to deploy and no npm SSH library to maintain.
- **Keys never leave your machine**: the ledger stores only `identityFile` *path references*. Key contents are never stored, never transmitted, and never appear in tool output. Password auth is intentionally unsupported.

## Storage (mirrors Orca's SSH-target model)

One JSON document — default `$DSH_HOME`/`~/.dsh/vpshub-targets.json`:

```jsonc
{
  "version": 1,
  "targets": [
    {
      "id": "vps-1786641416471-a1b2c3",
      "label": "aliyun-prod",
      "configHost": "orca",            // alias when imported from ~/.ssh/config
      "host": "1.2.3.4",
      "port": 22,
      "username": "root",
      "identityFile": "~/.ssh/id_ed25519",   // path only
      "source": "ssh-config" | "manual",     // ssh-config targets re-sync on import; manual never overwritten
      "tags": ["aliyun", "prod"],
      "note": "...",
      "lastSeenAt": 1786641416471,
      "createdAt": 1786641416471,
      "updatedAt": 1786641416471
    }
  ],
  "removedTargets": [],               // tombstones for clean re-add
  "deletedConfigAliases": []          // aliases suppressed from re-import after removal
}
```

`~/.ssh/config` is parsed with `Include` expansion and OpenSSH first-match-wins semantics; aliases are matched with `*`/`?` wildcards and a `Host *` fallback.

## Tools

| Tool | Purpose |
|---|---|
| `vps_list` | Discover ledger servers; filter by tag/text; optional `withStatus` connectivity probe |
| `vps_import_ssh_config` | Scan `~/.ssh/config` (Include-expanded) and list importable hosts with `alreadyInLedger` marks |
| `vps_add` | Add a server from a config alias or manual fields; optional pre-save `test` |
| `vps_remove` | Remove a server, keeping a tombstone + alias suppression |
| `vps_test` | Non-interactive connectivity check with latency |
| `vps_exec` | Run one shell command on a server (output truncated to 100KB) |
| `vps_upload` / `vps_download` | scp file transfer both ways |

## Install

The plugin is a host-plane Cordis plugin. Install it into your DSH profile's node_modules, then add a row to your profile `cordis.patch.yml`:

```bash
# from your DSH profile directory (e.g. ~/.dsh/profiles/web)
npm install dsh-vps-hub   # or: pnpm add dsh-vps-hub
```

```yaml
# cordis.patch.yml
- insert:
    - id: vps-hub
      name: 'dsh-vps-hub'
      config:
        # dataFile: '~/.dsh/vpshub-targets.json'   # optional override
        # maxOutputBytes: 100000                    # optional
        # connectTimeoutSec: 8                      # optional
```

Restart (or HMR-reload) the profile, then ask your agent: *"list my servers"* → `vps_list`; *"import my ssh config"* → `vps_import_ssh_config`; *"run df -h on the aliyun box"* → `vps_exec`.

### Dynamic-plugin prototype

The same capability was first validated as a session-scoped dynamic Cordis Plugin (`cordis_define` / `cordis_run`). That prototype is superseded by this package; the dynamic-plugin route remains handy for experimenting with tool surfaces without touching the composition.

## Security notes

- `BatchMode=yes` — no interactive prompts; `StrictHostKeyChecking=accept-new` auto-accepts on first connect (review if you need strict known_hosts enforcement).
- Commands are passed as a single argv element to `execFile`, so remote commands cannot inject local shell syntax.
- The ledger file is written atomically (`0600`). Keep your `identityFile`s `0600` as usual.
- Remote execution is a real power tool: the model can run arbitrary commands on servers you add. Use DSH's permission/approval layer if you want a confirmation gate.

## License

MIT
