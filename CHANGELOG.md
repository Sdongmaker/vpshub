# Changelog

All notable changes to **dsh-vps-hub** are documented here. Versions follow [SemVer](https://semver.org/).

## [0.1.3] — 2026-08-14

Security & robustness review pass (full code audit results):

### Fixed
- **ProxyCommand hardening**: `vps_add` now rejects proxyCommand values containing shell metacharacters (whitelist + `%h`/`%p` only) — ProxyCommand is executed by `ssh` through the **local shell**, so this closes an arbitrary-local-code-execution vector. Tool description and README warn about the shell semantics.
- **`StrictHostKeyChecking` option**: new `strictHostKeyChecking` config (default `false` = `accept-new`; `true` = `yes`) for MITM hardening.
- **Large-output handling**: output beyond the capture buffer now surfaces as a truncation notice instead of a hard `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` failure; capture buffer raised to 8 MB.
- **Concurrent-safe ledger writes**: temp files get a random suffix and `wx` (no-clobber) open — concurrent writers can no longer interleave the same temp file, and pre-planted symlinks cannot be followed.
- **Corrupted-ledger protection**: a ledger that fails to parse is backed up to `.corrupt-<ts>` and reported loudly instead of being silently reset to empty (data-loss prevention).
- **Pasted-key cleanup**: `vps_remove` now deletes private-key files owned by the removed target (only files under `~/.dsh/keys`).
- **scp proxy support**: `vps_upload`/`vps_download` now honor `jumpHost` and `proxyCommand` via `-o ProxyJump=`/`-o ProxyCommand=` (scp has no `-J`).
- **`lastSeenAt` semantics**: `vps_exec` only stamps `lastSeenAt` on success (consistent with `vps_test`).
- **Windows password guard**: password mode on Windows fails with a clear message (the `#!/bin/sh` SSH_ASKPASS bridge is POSIX-only) instead of a confusing auth failure.

### Dynamic-plugin example (examples/dynamic-plugin/)
- **Field validation**: host/username/identityFile/jumpHost/proxyCommand values are validated against safe character sets before entering shell commands (command-injection hardening); proxyCommand is quoted.
- **DSH_HOME support**: data paths honor `${DSH_HOME:-$HOME/.dsh}` (previously hardcoded `$HOME/.dsh` — the packaged plugin and the dynamic plugin now share the ledger even with DSH_HOME set).
- **Config glob escaping**: alias pattern matching uses full regex escaping (parity with the packaged plugin).
- **proxyCommand import**: config imports keep the full proxyCommand line (previously truncated to the first token).
- **Settings UI**: fixed a JSX-as-data nesting bug that rendered Paste-key/Jump-host/Proxy-cmd rows inside the Key-path row; the status dot now updates after Test; port parsing guards against NaN; remove clears stale status; `role="alert"`/`aria-live` for messages.

## [0.1.2] — 2026-08-14

### Fixed
- `Config` now tolerates `null` (`.nullish()`) — a bare YAML `config:` with only comments parses to `null` and previously failed zod validation, taking the loader entry (and the whole web profile) down. Docs/examples use `config: {}`.

## [0.1.1] — 2026-08-14

### Fixed (breaking load fix)
- `apply(ctx, config)` official signature — v0.1.0 read `ctx.config`, which the Cordis Guard rejects (`cannot get property "config" without inject`), failing the loader entry and crashing the whole `dsh web` process. If you are on v0.1.0, upgrade immediately.

## [0.1.0] — 2026-08-14

### Added
- Initial release: 8 agent tools (`vps_list` / `vps_import_ssh_config` / `vps_add` / `vps_remove` / `vps_test` / `vps_exec` / `vps_upload` / `vps_download`).
- Orca-style SSH ledger (`source: ssh-config | manual`, tombstones, deleted-alias suppression).
- Key-path auth, pasted-key saving (`~/.dsh/keys`, 0600), memory-only passwords via SSH_ASKPASS, ProxyJump/ProxyCommand.
- Settings-page UI as a dynamic-plugin example.
