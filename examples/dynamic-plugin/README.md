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
