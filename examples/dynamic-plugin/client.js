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

  // ── i18n: register zh/en dictionaries, bind translate fn ──
  // Keys are the English text itself, so without the locale service (or with
  // an unknown key) the UI falls back to readable English.
  const DICT_EN = {
    pageTitle: 'VPS Hub', ledgerHint: 'Server ledger (~/.dsh/vpshub-targets.json — keys stored as path references only, never transmitted)',
    loading: 'Loading…', emptyLedger: 'Ledger is empty — import from ~/.ssh/config below or add manually.',
    lastOnline: 'last online: ',
    addServer: 'Add server', addHint: 'Pick from ~/.ssh/config or fill in manually',
    configAlias: 'config alias', manual: '— manual —', inLedger: ', in ledger',
    displayName: 'Display name', namePh: 'e.g. hk-prod',
    host: 'Host / IP', port: 'Port', username: 'Username',
    keyPath: 'Key path', keyPathPh: '~/.ssh/id_ed25519 (path only)',
    pasteKey: 'Paste key', pasteKeyPh: 'Optional: paste key CONTENT — saved to ~/.dsh/keys (0600), never in ledger',
    password: 'Password', passwordPh: 'Optional: memory only, never persisted',
    jumpHost: 'Jump host', jumpHostPh: 'Optional: user@bastion:22 (ProxyJump)',
    proxyCmd: 'Proxy cmd', proxyCmdPh: 'Optional: nc -X 5 -x proxy:1080 %h %p',
    tags: 'Tags', tagsPh: 'web, prod (comma separated)', note: 'Note',
    testBeforeSave: 'Test connectivity before saving',
    addBtn: 'Add server', adding: 'Adding…', testBtn: 'Test', testing: 'Testing…', removeBtn: 'Remove',
    confirmRemove: 'Remove this server from the ledger?',
    added: 'added: ', removed: 'removed: ', online: ' online (', offline: ' offline: ', connectFailed: 'connect failed',
  }
  const DICT_ZH = {
    pageTitle: 'VPS 服务器', ledgerHint: '服务器台账 (~/.dsh/vpshub-targets.json — 密钥仅存路径引用,内容不出本机)',
    loading: '加载中…', emptyLedger: '台账为空 — 从下方 ~/.ssh/config 导入或手动添加。',
    lastOnline: '最后在线: ',
    addServer: '添加服务器', addHint: '从 ~/.ssh/config 选择或手动填写',
    configAlias: 'config 别名', manual: '— 手动填写 —', inLedger: ', 已在台账',
    displayName: '显示名称', namePh: '如 hk-prod',
    host: '主机 / IP', port: '端口', username: '用户名',
    keyPath: '私钥路径', keyPathPh: '~/.ssh/id_ed25519 (仅路径)',
    pasteKey: '粘贴密钥', pasteKeyPh: '可选:粘贴密钥内容 — 保存到 ~/.dsh/keys (0600),不入台账',
    password: '密码', passwordPh: '可选:仅内存,不落盘',
    jumpHost: '跳板机', jumpHostPh: '可选: user@bastion:22 (ProxyJump)',
    proxyCmd: '代理命令', proxyCmdPh: '可选: nc -X 5 -x proxy:1080 %h %p',
    tags: '标签', tagsPh: 'web, prod (逗号分隔)', note: '备注',
    testBeforeSave: '保存前测试连通',
    addBtn: '添加服务器', adding: '添加中…', testBtn: '测试连接', testing: '测试中…', removeBtn: '删除',
    confirmRemove: '确定从台账删除这台服务器?',
    added: '已添加: ', removed: '已删除: ', online: ' 在线 (', offline: ' 离线: ', connectFailed: '连接失败',
  }
  const locale = ctx.get('locale')
  let t = (k) => k
  if (locale !== undefined) {
    try {
      locale.register('vps-hub', 'en', DICT_EN)
      locale.register('vps-hub', 'zh', DICT_ZH)
      t = locale.bind('vps-hub')
    } catch { /* duplicate registration or unavailable → raw keys are English */ }
  }

  function VpsSection() {
    const [targets, setTargets] = React.useState(null)
    const [candidates, setCandidates] = React.useState([])
    const [form, setForm] = React.useState({ label: '', alias: '', host: '', port: '22', username: '', identityFile: '', identityKeyContent: '', password: '', jumpHost: '', proxyCommand: '', tags: '', note: '', test: false })
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
        if (r && r.error) setError(r.error)
        else setCandidates(r.candidates || [])
      }).catch((e) => setError(String(e)))
    }, [])

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
    const setBool = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }))

    const pickAlias = (e) => {
      const alias = e.target.value
      setForm((f) => ({ ...f, alias }))
      const c = candidates.find((x) => x.alias === alias)
      if (c) {
        setForm((f) => ({ ...f, alias, host: c.hostname, port: String(c.port || 22), username: c.username || '', identityFile: c.identityFile || '', identityKeyContent: '', password: '', label: c.alias }))
      }
    }

    // host.call args must be plain JSON: build explicitly, drop empty values.
    const collectArgs = () => {
      const a = {}
      if (form.label) a.label = form.label
      if (form.alias) a.alias = form.alias
      if (form.host) a.host = form.host
      const parsedPort = parseInt(form.port, 10)
      if (form.port && Number.isFinite(parsedPort)) a.port = parsedPort
      if (form.username) a.username = form.username
      if (form.identityFile) a.identityFile = form.identityFile
      if (form.identityKeyContent) a.identityKeyContent = form.identityKeyContent
      if (form.password) a.password = form.password
      if (form.jumpHost) a.jumpHost = form.jumpHost
      if (form.proxyCommand) a.proxyCommand = form.proxyCommand
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
        setMsg(t('added') + (r.label || r.id) + (r.testResult ? ' (' + r.testResult + ')' : ''))
        setForm({ label: '', alias: '', host: '', port: '22', username: '', identityFile: '', identityKeyContent: '', password: '', jumpHost: '', proxyCommand: '', tags: '', note: '', test: false })
        refresh()
      }).catch((e) => { setBusy(false); setError(String(e)) })
    }

    const doRemove = (id) => {
      if (!window.confirm(t('confirmRemove'))) return
      setError(''); setMsg('')
      host.call('vps.remove', { id }).then((r) => {
        if (r && r.error) setError(r.error)
        else { setMsg(t('removed') + r.label); refresh() }
      }).catch((e) => setError(String(e)))
    }

    const doTest = (t) => {
      setTesting((s) => ({ ...s, [t.id]: true }))
      host.call('vps.test', { id: t.id }).then((r) => {
        setTesting((s) => ({ ...s, [t.id]: false }))
        if (r && r.error) setError(r.error)
        else {
          setMsg(r.ok ? t.label + t('online') + r.ms + 'ms)' : t.label + t('offline') + (r.error || t('connectFailed')))
          // reflect the probe result on the card dot (status is otherwise
          // only populated by vps.list withStatus)
          setTargets((prev) => (prev || []).map((x) => (x.id === t.id ? { ...x, status: r.ok ? 'online' : 'offline' } : x)))
        }
      }).catch((e) => { setTesting((s) => ({ ...s, [t.id]: false })); setError(String(e)) })
    }

    const statusDot = (t) => h('span', { className: 'vpsh-dot ' + (t.status === 'online' ? 'vpsh-online' : t.status === 'offline' ? 'vpsh-offline' : 'vpsh-unknown') })

    const list = targets === null
      ? h('div', { className: 'vpsh-muted' }, t('loading'))
      : targets.length === 0
        ? h('div', { className: 'vpsh-muted' }, t('emptyLedger'))
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, targets.map((t) =>
            h('div', { key: t.id, className: 'vpsh-card' },
              h('div', { className: 'vpsh-card-head' },
                statusDot(t),
                h('span', { className: 'vpsh-label' }, t.label),
                h('span', { className: 'vpsh-muted' }, (t.username ? t.username + '@' : '') + t.host + (t.port && t.port !== 22 ? ':' + t.port : '')),
                h('span', { className: 'vpsh-badge' }, t.source === 'ssh-config' ? 'ssh-config' : 'manual'),
                (t.tags || []).map((g) => h('span', { key: g, className: 'vpsh-badge' }, g)),
                h('span', { style: { flex: 1 } }),
                h('button', { className: 'vpsh-btn', disabled: !!testing[t.id], onClick: () => doTest(t) }, testing[t.id] ? t('testing') : t('testBtn')),
                h('button', { className: 'vpsh-btn vpsh-btn-danger', onClick: () => doRemove(t.id) }, t('removeBtn')),
              ),
              t.note ? h('div', { className: 'vpsh-hint' }, t.note) : null,
              t.lastSeenAt ? h('div', { className: 'vpsh-hint' }, t('lastOnline') + new Date(t.lastSeenAt).toLocaleString()) : null,
            )
          ))

    return h('div', { className: 'vpsh-wrap' },
      error ? h('div', { className: 'vpsh-err', role: 'alert' }, error) : null,
      msg ? h('div', { className: 'vpsh-msg', role: 'status', 'aria-live': 'polite' }, msg) : null,
      h('div', { className: 'vpsh-hint' }, t('ledgerHint')),
      list,
      h('div', { className: 'vpsh-form' },
        h('div', { className: 'vpsh-row' },
          h('strong', null, t('addServer')),
          h('span', { className: 'vpsh-hint' }, t('addHint')),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('configAlias')),
          h('select', { className: 'vpsh-select', value: form.alias, onChange: pickAlias },
            h('option', { value: '' }, t('manual')),
            candidates.map((c) => h('option', { key: c.alias, value: c.alias }, c.alias + ' (' + (c.hostname) + (c.alreadyInLedger ? t('inLedger') : '') + ')')),
          ),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('displayName')),
          h('input', { className: 'vpsh-input', value: form.label, onChange: set('label'), placeholder: t('namePh') }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('host')),
          h('input', { className: 'vpsh-input', value: form.host, onChange: set('host'), placeholder: '1.2.3.4' }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('port')),
          h('input', { className: 'vpsh-input', value: form.port, onChange: set('port'), style: { width: 90 } }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('username')),
          h('input', { className: 'vpsh-input', value: form.username, onChange: set('username'), placeholder: 'root' }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('keyPath')),
          h('input', { className: 'vpsh-input', value: form.identityFile, onChange: set('identityFile'), placeholder: t('keyPathPh') }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('pasteKey')),
          h('textarea', { className: 'vpsh-input', value: form.identityKeyContent, onChange: set('identityKeyContent'), placeholder: t('pasteKeyPh'), rows: 4, style: { fontFamily: 'monospace', fontSize: 11, resize: 'vertical' } }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('password')),
          h('input', { className: 'vpsh-input', type: 'password', value: form.password, onChange: set('password'), placeholder: t('passwordPh') }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('jumpHost')),
          h('input', { className: 'vpsh-input', value: form.jumpHost, onChange: set('jumpHost'), placeholder: t('jumpHostPh') }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('proxyCmd')),
          h('input', { className: 'vpsh-input', value: form.proxyCommand, onChange: set('proxyCommand'), placeholder: t('proxyCmdPh') }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('tags')),
          h('input', { className: 'vpsh-input', value: form.tags, onChange: set('tags'), placeholder: t('tagsPh') }),
        ),
        h('div', { className: 'vpsh-form-row' },
          h('label', null, t('note')),
          h('input', { className: 'vpsh-input', value: form.note, onChange: set('note') }),
        ),
        h('div', { className: 'vpsh-row' },
          h('label', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('input', { type: 'checkbox', checked: form.test, onChange: setBool('test') }),
            t('testBeforeSave'),
          ),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'vpsh-btn vpsh-btn-primary', disabled: busy, onClick: doAdd }, busy ? t('adding') : t('addBtn')),
        ),
      ),
    )
  }

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'vps-hub', order: 30, label: () => t('pageTitle') },
    () => h(VpsSection),
  ))
}
