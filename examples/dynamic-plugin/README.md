# Dynamic-plugin mode (Settings-page UI without installing the package)

The packaged `dsh-vps-hub` (install via npm) provides the eight `vps_*` model
tools. If you also want the **Settings → VPS Hub page** (Orca-style UI:
server cards, test-connect, add form with `~/.ssh/config` alias prefill,
remove) **without installing the package**, load this example as a session
dynamic Cordis Plugin:

1. In a DSH session with dynamic-plugin support, call `cordis_define` with:

   - `code.host`:
     ```js
     return {
       name: 'vps-hub',
       apply: /* paste the body of apply() from host.js —
                 i.e. the whole file minus the first line
                 "export function apply(ctx) {" and its final closing "}" */
     }
     ```

   - `code.client`:
     ```js
     return {
       name: 'vps-hub-ui',
       apply: /* paste the body of apply() from client.js the same way */
     }
     ```

2. `cordis_run` the returned package. The client half asks for approval once —
   allow it in the UI.

3. Now, for the life of the session (until DSH restarts):
   - the eight tools `vps_list` / `vps_import_ssh_config` / `vps_add` /
     `vps_remove` / `vps_test` / `vps_exec` / `vps_upload` / `vps_download`
     are callable by the agent;
   - **Settings → VPS Hub** shows the server ledger UI.

The ledger file `~/.dsh/vpshub-targets.json` is shared with the packaged
plugin, so both modes interoperate. Keys stay path references only.

> Note: dynamic plugins are session-scoped and vanish on DSH restart (the
> ledger file persists). For a permanent install, use the npm package instead —
> see the repository README.
## Two ways to use these files

**A. Full dynamic plugin (standalone — tools + UI, no npm install)**
Use `host.js` + `client.js`. The session gets both the eight `vps_*` tools
AND the Settings UI. Do NOT also mount the npm package in the same session —
tool names would collide.

**B. UI-only overlay (recommended when the npm package is installed)**
Use `ui-only-host.js` + `client.js`. The npm package keeps serving the tools;
this overlay adds ONLY the Settings → VPS Hub page and its RPC handlers, so
both coexist. Steps:

1. `cordis_define`:
   - `code.host`: paste `apply()`'s body from `ui-only-host.js` as
     `return { name: 'vps-hub-ui-rpc', apply: <body> }`
   - `code.client`: paste `apply()`'s body from `client.js` as
     `return { name: 'vps-hub-ui', apply: <body> }`
2. `cordis_run` and approve the client half once.
3. Settings → VPS Hub.

### Approval policy note

The client half needs a one-time approval. If your deployment runs with
approval disabled (`DSH_PERMISSION_MODE=danger-full-access` / policy
`never`), dynamic client plugins cannot be authorized — switch the session
permission mode to `workspace-write` (Settings → 权限 → ask) or set
`DSH_PERMISSION_MODE=ask` for the session where you load the UI, approve,
then switch back. The ledger and tools are unaffected.

