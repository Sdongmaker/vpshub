/**
 * dsh-vps-hub — dynamic-plugin Client half (Settings-page UI).
 *
 * Renders a "VPS Hub" page in Settings (settings.section slot) that mirrors
 * Orca's Settings → SSH: server cards with status/test/delete, an add form
 * with ~/.ssh/config alias prefill, and connectivity testing.
 *
 * Talks to the Host half through Package-private RPC (host.call):
 *   vps.list / vps.candidates / vps.add / vps.remove / vps.test
 *
 * Verified end-to-end in a real session: discover → test-connect → add →
 * delete → alias prefill, all through the Settings UI.
 *
 * Usage: in cordis_define's code.client write:
 *     return {
 *       name: 'vps-hub-ui',
 *       apply: <the body of apply() below — this file without the
 *              "export function apply(ctx) {" line and its closing "}" >
 *     }
 * and examples/dynamic-plugin/host.js in code.host, then cordis_run and
 * approve the client half.
 *
 * Verified end-to-end in a real session: discover → test-connect → add →
 * delete → alias prefill, all through the Settings UI.
 */
export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  styles.insert(`
.vpsh-wrap { font-size: 13px; display: flex; flex-direction: column; gap: 14px; }
.vpsh-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.vpsh-card { border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; background: rgba(128,128,128,.06); }
.vpsh-card-head { display: flex; align-items: center; gap: 8px; }
.vpsh-label { font-weight: 600; }
.vpsh-muted { opacity: .65; font-size: 12px; }
.vpsh-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.vpsh-online { background: #2ecc71; } .vpsh-offline { background: #e74c3c; } .vpsh-unknown { background: #95a5a6; }
.vpsh-badge { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: rgba(128,128,128,.2); }
.vpsh-input, .vpsh-select { background: rgba(128,128,128,.08); border: 1px solid rgba(128,128,128,.35); border-radius: 6px; padding: 5px 8px; color: inherit; font-size: 13px; }
.vpsh-input:focus, .vpsh-select:focus { outline: none; border-color: rgba(100,160,255,.7); }
.vpsh-btn { border: 1px solid rgba(128,128,128,.4); background: rgba(128,128,128,.1); border-radius: 6px; padding: 5px 10px; cursor: pointer; color: inherit; font-size: 12px; }
.vpsh-btn:hover { background: rgba(128,128,128,.2); }
.vpsh-btn-primary { border-color: rgba(100,160,255,.6); background: rgba(100,160,255,.15); }
.vpsh-btn-danger:hover { background: rgba(231,76,60,.2); border-color: rgba(231,76,60,.5); }
.vpsh-btn:disabled { opacity: .5; cursor: default; }
.vpsh-form { border: 1px dashed rgba(128,128,128,.4); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.vpsh-form-row { display: grid; grid-template-columns: 110px 1fr; gap: 6px 10px; align-items: center; }
.vpsh-form-row label { opacity: .75; font-size: 12px; }
.vpsh-err { color: #e74c3c; font-size: 12px; }
.vpsh-msg { color: #2ecc71; font-size: 12px; }
.vpsh-hint { font-size: 12px; opacity: .6; }
`)

  const h = React.createElement

  function VpsSection() {
    const [targets, setTargets] = React.useState(null)
    const [candidates, setCandidates] = React.useState([])
    const [form, setForm] = React.useState({ label: '', alias: '', host: '', port: '22', username: '', identityFile: '', tags: '', note: '', test: false })
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [msg, setMsg] = React.useState('')
    const [testing, setTesting] = React.useState({})

    const refresh = () => {
      host.call('vps.list', {}).then((r) => {
        if (r && r.error) setError(r.error)
        else setTargets(r.targets || [])
      }).catch((e) => setError(String(e)))
    }

    React.useEffect(() => {
      refresh()
      host.call('vps.candidates', {}).then((r) => {
        if (r && !r.error) setCandidates(r.candidates || [])
      }).catch(() => {})
    }, [])

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
    const setBool = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }))

    const pickAlias = (e) => {
      const alias = e.target.value
      setForm((f) => ({ ...f, alias }))
      const c = candidates.find((x) => x.alias === alias)
      if (c) {
        setForm((f) => ({ ...f, alias, host: c.hostname, port: String(c.port || 22), username: c.username || '', identityFile: c.identityFile || '', label: c.alias }))
      }
    }

    // host.call args must be plain JSON: build explicitly, drop empty values.
    const collectArgs = () => {
      const a = {}
      if (form.label) a.label = form.label
      if (form.alias) a.alias = form.alias
      if (form.host) a.host = form.host
      if (form.port) a.port = parseInt(form.port, 10)
      if (form.username) a.username = form.username
      if (form.identityFile) a.identityFile = form.identityFile
      if (form.tags) a.tags = form.tags.split(/[,，\s]+/).filter(Boolean)
      if (form.note) a.note = form.note
      a.test = !!form.test
      return a
    }

    const doAdd = () => {
      setBusy(true); setError(''); setMsg('')
      host.call('vps.add', collectArgs()).then((r) => {
        setBusy(false)
        if (r && r.error) { setError(r.error); return }
        setMsg('added: ' + (r.label || r.id) + (r.testResult ? ' (' + r.testResult + ')' : ''))
        setForm({ label: '', alias: '', host: '', port: '22', username: '', identityFile: '', tags: '', note: '', test: false })
        refresh()
      }).catch((e) => { setBusy(false); setError(String(e)) })
    }

    const doRemove = (id) => {
      if (!window.confirm('Remove this server from the ledger?')) return
      host.call('vps.remove', { id }).then((r) => {
        if (r && r.error) setError(r.error)
        else { setMsg('removed: ' + r.label); refresh() }
      }).catch((e) => setError(String(e)))
    }

    const doTest = (t) => {
      setTesting((s) => ({ ...s, [t.id]: true }))
      host.call('vps.test', { id: t.id }).then((r) => {
        setTesting((s) => ({ ...s, [t.id]: false }))
        if (r && r.error) setError(r.error)
        else {
          setMsg(r.ok ? t.label + ' online (' + r.ms + 'ms)' : t.label + ' offline: ' + (r.error || 'connect failed'))
          refresh()
        }
      }).catch((e) => { setTesting((s) => ({ ...s, [t.id]: false })); setError(String(e)) })
    }

    const statusDot = (t) => h('span', { className: 'vpsh-dot ' + (t.status === 'online' ? 'vpsh-online' : t.status === 'offline' ? 'vpsh-offline' : 'vpsh-unknown') })

    const list = targets === null
      ? h('div', { className: 'vpsh-muted' }, 'Loading…')
      : targets.length === 0
        ? h('div', { className: 'vpsh-muted' }, 'Ledger is empty — import from ~/.ssh/config below or add manually.')
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, targets.map((t) =>
            h('div', { key: t.id, className: 'vpsh-card' },
              h('div', { className: 'vpsh-card-head' },
                statusDot(t),
                h('span', { className: 'vpsh-label' }, t.label),
                h('span', { className: 'vpsh-muted' }, (t.username ? t.username + '@' : '') + t.host + (t.port && t.port !== 22 ? ':' + t.port : '')),
                h('span', { className: 'vpsh-badge' }, t.source === 'ssh-config' ? 'ssh-config' : 'manual'),
                (t.tags || []).map((g) => h('span', { key: g, className: 'vpsh-badge' }, g)),
                h('span', { style: { flex: 1 } }),
                h('button', { className: 'vpsh-btn', disabled: !!testing[t.id], onClick: () => doTest(t) }, testing[t.id] ? 'Testing…' : 'Test'),
                h('button', { className: 'vpsh-btn vpsh-btn-danger', onClick: () => doRemove(t.id) }, 'Remove'),
              ),
              t.note ? h('div', { className: 'vpsh-hint' }, t.note) : null,
              t.lastSeenAt ? h('div', { className: 'vpsh-hint' }, 'last online: ' + new Date(t.lastSeenAt).toLocaleString()) : null,
            )
          ))

    return h('div', { className: 'vpsh-wrap' },
      error ? h('div', { className: 'vpsh-err' }, error) : null,
      msg ? h('div', { className: 'vpsh-msg' }, msg) : null,
      h('div', { className: 'vpsh-hint' }, 'Server ledger (~/.dsh/vpshub-targets.json — keys stored as path references only, never transmitted)'),
      list,
      h('div', { className: 'vpsh-form' },
        h('div', { className: 'vpsh-row' },
          h('strong', null, 'Add server'),
          h('span', { className: 'vpsh-hint' }, 'Pick from ~/.ssh/config or fill in manually'),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, 'config alias'),
          h('select', { className: 'vpsh-select', value: form.alias, onChange: pickAlias },
            h('option', { value: '' }, '— manual —'),
            candidates.map((c) => h('option', { key: c.alias, value: c.alias }, c.alias + ' (' + (c.hostname) + (c.alreadyInLedger ? ', in ledger' : '') + ')')),
          ),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, 'Display name'),
          h('input', { className: 'vpsh-input', value: form.label, onChange: set('label'), placeholder: 'e.g. hk-prod' }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, 'Host / IP'),
          h('input', { className: 'vpsh-input', value: form.host, onChange: set('host'), placeholder: '1.2.3.4' }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, 'Port'),
          h('input', { className: 'vpsh-input', value: form.port, onChange: set('port'), style: { width: 90 } }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, 'Username'),
          h('input', { className: 'vpsh-input', value: form.username, onChange: set('username'), placeholder: 'root' }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, 'Key path'),
          h('input', { className: 'vpsh-input', value: form.identityFile, onChange: set('identityFile'), placeholder: '~/.ssh/id_ed25519 (path only)' }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, 'Tags'),
          h('input', { className: 'vpsh-input', value: form.tags, onChange: set('tags'), placeholder: 'web, prod (comma separated)' }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, 'Note'),
          h('input', { className: 'vpsh-input', value: form.note, onChange: set('note') }),
        ),
        h('div', { className: 'vpsh-row' },
          h('label', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('input', { type: 'checkbox', checked: form.test, onChange: setBool('test') }),
            'Test connectivity before saving',
          ),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'vpsh-btn vpsh-btn-primary', disabled: busy, onClick: doAdd }, busy ? 'Adding…' : 'Add server'),
        ),
      ),
    )
  }

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'vps-hub', order: 30, label: 'VPS Hub' },
    () => h(VpsSection),
  ))
}
