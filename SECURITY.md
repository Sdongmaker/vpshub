# Security Policy

## Scope

`dsh-vps-hub` manages SSH credentials for cloud servers:

- The ledger (`~/.dsh/vpshub-targets.json`) stores **paths only** — never key contents, never passwords.
- Pasted key CONTENT is written to `~/.dsh/keys/<id>.key` (mode 0600, directory 0700) and referenced by path.
- Passwords live in **process memory only** (cleared on DSH restart) and reach `ssh` via the `SSH_ASKPASS` bridge with the value in the child environment (`VPS_PASSWORD`) — never in argv, never on disk. Same-user processes on POSIX systems may read a child's environment via `/proc/<pid>/environ`; treat passwords as visible to anything running as your user.
- Remote commands are passed as a single argv element to `execFile` (packaged plugin) — no local shell interpolation. **Exception**: `proxyCommand` is executed by `ssh` through the local shell by design; values are restricted to a whitelist character set plus `%h`/`%p` placeholders.
- Password mode is POSIX-only (the askpass bridge is a `#!/bin/sh` script); Windows fails with a clear message.

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities. Report privately:

- GitHub private advisory: https://github.com/Sdongmaker/vpshub/security/advisories/new
- Or email the maintainer (see the repository profile).

Include: affected version(s), a minimal repro (redacted), and impact. You should receive a response within 3 business days.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x (latest) | ✅ |
| 0.1.0 | ❌ (has the loader-crash defect — upgrade to 0.1.1+) |

## Hardening tips

- Prefer key **paths** over pasted key content: pasted content passes through the model call as a tool argument.
- Enable `strictHostKeyChecking: true` in the plugin config to enforce `known_hosts` (default is `accept-new`).
- Keep `~/.ssh`, `~/.dsh` and all key files at 0600/0700.
