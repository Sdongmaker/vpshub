# Changelog

All notable changes to **dsh-vps-hub** are documented here. Versions follow [SemVer](https://semver.org/).

## [0.1.8] — 2026-08-14

### Fixed (audit round: two more P0 collateral sites from the t→tr rename)
- **`set(` → `setr(`**: the same global replace that broke `ctx.get` in 0.1.6
  also hit all eleven `onChange: set('field')` form handlers — every form
  field in the Settings UI threw ReferenceError. Restored all 11 sites.
- **`slots.inject(` → `slots.injectr(`**: the settings-section registration
  itself was broken by the same collateral — restored.
- Added a systematic identifier scan (`[a-zA-Z]+r\('`) and a mock-render
  verification (function-component deep render with mocked React/host/locale)
  so this class of silent rename damage cannot ship again.

## [0.1.7] — 2026-08-14

### Fixed (issues #11–#13)
- **#11 [P0] `t→tr` rename collateral**: the global replace of `t('` also
  hit `ctx.get('` → `ctx.getr('` in the Settings UI — the page could not
  load at all in 0.1.6. Restored `ctx.get` (2 sites).
- **#12 [P1] non-lossless tool result**: `vps_add` without `test` returned
  `testResult: undefined`; tool results are now normalized through `clean()`
  (undefined → null) at registration — affected every version since 0.1.0.
- **#13 [P1] candidates with undefined fields**: `vps_import_ssh_config`
  returned optional fields as `undefined`; now covered by the same `clean()`.

## [0.1.6] — 2026-08-14

### Fixed (issues #6–#10)
- **#6 [P1] i18n variable shadowing**: the translate function was shadowed by
  `targets.map((t) => …)` and `doTest(t)` parameters — non-empty ledgers
  crashed the list and Test messages failed. Translate fn renamed to `tr`.
- **#7 dynamic examples**: `host.js` and `ui-only-host.js` were missing the
  whole review-round fixes (DSH_HOME, full proxyCommand on import, glob
  escaping, `validateTargetFields` **definition** — calls existed without the
  function, a runtime ReferenceError). All five patches applied atomically and
  `ui-only-host.js` regenerated from the fixed host half.
- **#9 Windows password target**: `vps_add` with a password on Windows now
  refuses to save the target (it could never authenticate) instead of saving
  it with an unusable password.
- **#10 packaging**: npm package now ships `examples/` (smoke test, dynamic
  plugin UI, patch example). Tool descriptions stay English (model-facing
  convention); the source badge shows the raw `ssh-config`/`manual` value by
  design.

## [0.1.5] — 2026-08-14

### Fixed (issues #2–#5 review round)
- **`src/index.js`**
  - `vps_import_ssh_config` keeps the FULL proxyCommand line for imported
    aliases (was truncated to the first token); imported proxyCommand is now
    validated against the safe whitelist too (#4-1).
  - `vps_add` connectivity test now honors `strictHostKeyChecking` (#4-2).
  - `vps_remove` key cleanup checks a real path-separator boundary — sibling
    dirs like `~/.dsh/keys2/…` can no longer match (#4-3).
- **Settings UI (`client.js`)**
  - Fixed the Key-path form-row nesting bug for real (rows are now siblings;
    the 0.1.3 changelog entry claiming this fix was wrong — it never landed).
  - `vps.candidates` failures are surfaced instead of silently swallowed (#5-1).
  - **i18n**: zh/en dictionaries registered through the harness `locale`
    service; all UI strings go through `t()`; the settings section label
    follows the active locale (`VPS Hub` ↔ `VPS 服务器`) (#2). Without a
    locale service the UI falls back to English keys.
- **Dynamic examples**
  - `ui-only-host.js` regenerated from the fixed host half (DSH_HOME honored;
    the 0.1.3 changelog claim was wrong for this file).
  - Both host halves documented as POSIX-only (#3-1).
- **Docs**: platform notes corrected — Windows works for key-based auth with
  the packaged plugin; password auth and the dynamic examples are POSIX-only
  (#3-2). CHANGELOG 0.1.3 entries that claimed fixes that never landed are
  corrected here.

## [0.1.4] — 2026-08-14

### Docs
- README (en/zh) and npm metadata synced with the repo: UI-only overlay
  instructions, security sections, project layout, homepage/bugs fields.
  No code changes — package contents identical to 0.1.3.

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
