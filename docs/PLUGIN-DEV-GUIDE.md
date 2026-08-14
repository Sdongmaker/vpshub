# DSH 插件开发-测试-发布实战指南

> 从零开发一个 DeepSeek Harness(Cordis)插件的完整经验沉淀 —— 以 `dsh-vps-hub`(VPS 台账 + SSH 工具 + 设置页 UI)为实例,覆盖**架构认知 → 原型开发 → 端到端验证 → 打包发布**全流程,以及过程中真实踩过的坑。
>
> 适用:任何要在 DSH 上提供"Agent 可调用工具"或"设置页界面"的插件。

---

## 0. 先建立架构认知(决定一切后续决策)

DSH 有三层插件形态,先选对层:

| 形态 | 生命周期 | 典型用途 | 何时选它 |
|---|---|---|---|
| **组合层行**(`cordis.patch.yml` 加一行 `name: '包名'`) | 进程级持久 | 正式能力 | 最终交付形态 |
| **Agent 预设**(`~/.dsh/.agent-presets/<id>/agent.cordis.yml`) | 每会话 | 工具面/人设 | 只影响单个 Agent 会话 |
| **动态插件**(`cordis_define`/`cordis_run`) | 会话级,重启消失 | **原型验证** | 开发阶段,零配置改动 |

**两个平面规则**(决定服务/数据放哪):
- **Host 平面**:注册表(`tools`/`skills`/`subagents`)、跨会话共享的持久化、沙箱/审批、模型路由。
- **Agent 预设平面**:每会话的工具、prompt 段。预设里**发布服务必须套 `isolate` realm**,否则第二个会话挂载时冲突。
- 动态插件注册的工具对模型可见,但**数据持久化不属于动态插件**——动态插件只是验证载体。

**推荐路径(本次实证)**:动态插件原型(验证工具面 + UI 交互)→ 收敛为 npm 包(host 平面组合行)→ 发布 npm + GitHub。

---

## 1. 开发流程(五步)

### 1.1 研究:先读运行时,不猜 API

1. `cordis_inspect_list` → 看 Host/Client 有哪些 Inspect Provider(Service/Event/Builtin/Slots/Theme/Tool)。
2. `cordis_inspect_query` 查精确契约:
   - Host `Service.listService` → 你要用的服务签名(如 `shell`、`fs`、`credentials`)。
   - Client `Builtin.listBuiltins` → 可用符号(**动态插件环境只有** `ctx`/`harness`/`console`/`btoa`/`atob`/`TextEncoder`;Client 只有 `ctx`/`React`/`host`/`styles`/`console`)。
   - Client `Slots.listSubTree` → 设置页/侧栏/工具栏等 Slot 的注册协议与 props。
3. 对照官方包的 `package.json`/README(安装目录 `node_modules/@deepseek-ai/dsh-*/`)学打包模式。

### 1.2 原型:cordis_define 一个最小可用版

- `code.host` 是**函数体**,返回 `{ name, apply(ctx) {...} }`;`code.client` 同理。纯 JS,无 TS/JSX/import。
- 工具注册:`harness.registerTool(ctx, harness.defineTool({ name, description, parameters, output, execute }))`。
- **`output` 必填**:`{ schema, render: (_args, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] }`。
- 服务访问:`ctx.get('shell')` + undefined 检查;硬依赖才 `inject`。
- Package 不可变:每改一版追加新 Package(`kind: 'existing'`),`cordis_run mode: 'update'` 切换。

### 1.3 验证:三层测试法(见 §3)

### 1.4 打包:收敛为正式包(见 §4)

### 1.5 发布(见 §5)

---

## 2. 关键设计决策(本项目的实证)

| 问题 | 决策 | 原因 |
|---|---|---|
| 数据存哪 | 单一 JSON(`~/.dsh/vpshub-targets.json`),原子写(0600) | 对标 Orca 的 `orca-data.json`;比 settings 命名空间自由(不依赖 api-proxy allowlist) |
| 密钥 | 台账只存 `identityFile` **路径**;粘贴的密钥内容存 `~/.dsh/keys/<id>.key`(0600);密码只存**内存** | 密钥内容不出本机;密码对标 Orca 内存缓存,重启即清 |
| 执行 | 系统 `ssh`/`scp` 二进制;正式包用 `execFile`(argv 数组,无 shell 注入) | 零 npm 依赖;动态插件无 `process`,用 `ctx.shell` 服务 |
| 密码传递 | `SSH_ASKPASS` + 子进程环境(`VPS_PASSWORD`) | 密码不进 argv/文件/日志;`SSH_ASKPASS_REQUIRE=force` 强制 |
| 设置页 UI | Client half 注册 `settings.section`(新 id) | 官方 `settings.plugins.tab` 卡片受 api-proxy 命名空间 allowlist 限制;`settings.section` 是开放 list slot |
| Client→Host 通信 | 动态插件:`harness.handle` + `host.call`(Package-private RPC) | 官方正式包的 `ctx.remote` 依赖 Typert Remote **装饰器**(TS 构建),纯 JS 包做不了 |

---

## 3. 测试方法论(三层,按成本递增)

### 3.1 冒烟测试(node 直跑发布包)

```js
// 假 ctx 注册工具,验证工具能注册、数据逻辑正确
const registered = []
apply({ config: {}, tools: { register: (t) => registered.push(t) } })
const res = await byName('vps_exec').execute({ id, command: 'hostname' })
```

- 不需要 DSH 进程,秒级反馈;适合 CI。
- 局限:不验证模型调用链路、不验证浏览器 UI。

### 3.2 自检插件(Host 内验证)

动态插件的一个变体:不注册工具,`apply` 里直接跑核心逻辑,结果写文件(`~/.dsh/selfcheck.txt`)或 `console.log`(读 Run 诊断)。

**注意**:`console.log` 不一定会出现在你能读到的地方 —— **写文件最可靠**。

### 3.3 浏览器闭环测试(computer-use)

用 Orca 的 computer-use 驱动真实浏览器操作 UI:

```text
orca computer get-app-state --app com.google.Chrome --window-id <id> --json   # 读 accessibility 树
orca computer click/set-value/press-key --app ... --element-index <n> --json
```

要点:
- 元素索引**短命**:每次操作后重新 `get-app-state` 拿新索引。
- 原生对话框(`window.confirm`)是**独立窗口**,出现在 `list-windows` 里,切 window-id 操作。
- 截图不可用时用 accessibility 树(索引 + 值)做断言。

---

## 4. 踩坑清单(本项目的全部教训)

### Host 动态插件环境

1. **没有 `process`/`require`/`fs`** —— 读写文件走 `ctx.get('shell')` 执行 bash(`cat`/heredoc)。
2. **`ShellRunResult` 字段不是你以为的**:
   - 退出码是 **`exitCode`**(不是 `code`);
   - 输出是 **`CollectedOutput` 对象**:`r.stdout.text`(不是字符串);
   - 还有 `timedOut`/`aborted`/`timeoutMs`。
   - 错误表现:`(r.stdout || "").trim is not a function` → 查 `dsh-shell` 的 `types.d.ts`。
3. **heredoc 结束符必须独占一行** —— 结束符后接 `&& echo OK` 会把整行写进文件(exit 0 但内容脏)。
4. **工具定义必须带 `output: { schema, render }`**,否则 `cordis_run` 直接报错。

### RPC 与 JSON 边界(最容易连环踩)

5. **`harness.handle` 返回值必须无损 JSON**:对象里任何 `undefined` 字段(如 `proxyJump: undefined`)都会 reject —— 写递归 `clean()`(`undefined → null`)。
6. **`host.call` 的参数同样要求纯 JSON**:`{ label: form.label || undefined }` 这种写法会被拒 —— **显式构建参数对象,只放有值的字段**。
7. 错误都在浏览器 console / Run 卡显示,报错信息会精确到字段名 —— 照它修。

### Client / UI

8. Client 代码**无 JSX**:`React.createElement` 手写;模板字符串写 CSS 用 `styles.insert`。
9. Client 插件首次运行**需要用户在 UI 授权**(approval);`cordis_run` 返回 `awaiting-approval` 时结束回合等用户,不要重试。
10. Slot 注册:`slots.inject('settings.section', () => slots.register({ name, id, order, label }, (props) => h(Comp)))`;`id` 用新的(复用官方 id 会替换官方页面)。
11. 表单输入后**元素索引变化**(重渲染),computer-use 要重新取树。

### 打包/发布

12. Cordis 包导出 `{ name, apply, inject, Config }`(ESM 命名导出);Config 用 zod schema。
13. **Client half 进正式包**需要:package.json 声明 `dsh.client: { platform: 'web' }` + exports 提供 `./client`;但纯 JS 包无法用 Typert `@Remote` 装饰器(TS 专属)—— 本项目的 UI 以动态插件示例发布,README 说明原因。
14. npm 发布:**2FA 账号必须用 Automation 类型令牌**(普通 granular token 会 403 "bypass 2fa required");令牌存 `~/.npmrc`(0600),**绝不要进仓库**。
15. 发布前 `npm pack --dry-run` 检查 tarball 内容(`files` 白名单);发布后 `npm view` + 全新目录 `npm install` + import 验证。

---

## 5. 发布清单(正式包)

```text
□ package.json:name/version/description/repository/license/exports/files/peerDependencies
□ 源码导出 { name, apply, inject, Config }
□ README.md + README.zh.md(安装/工具表/存储/安全/限制)
□ examples/:挂载示例(cordis.patch.yml)+ 冒烟测试 + 动态插件版(如有 UI)
□ LICENSE(MIT)
□ npm pack --dry-run 检查内容
□ npm publish(Automation token)→ npm view 验证 → 全新目录 npm install + import 测试
□ GitHub:仓库 + 相关 topics(如 dsh-plugin)→ 生态目录 PR(如有 awesome 列表,按对方模板提交)
□ 安装文档与发布状态同步(README badge)
```

## 6. 安全检查(每次发布前过一遍)

- [ ] 密钥/口令内容绝不进台账、日志、工具输出、argv
- [ ] 敏感文件权限 0600/0700,原子写
- [ ] 远程命令以 argv 传递(execFile)或正确转义(quoteSh)
- [ ] 超时与输出截断(防止刷爆上下文)
- [ ] 工具描述里写清楚安全边界(如"仅接受路径,不接受密钥内容")
- [ ] 文档说明权衡项(如"粘贴密钥会经过模型调用,优先用路径")

---

## 7. 参考资源

| 资源 | 位置 |
|---|---|
| 官方包元数据范式 | 安装目录 `node_modules/@deepseek-ai/dsh-mcp-client/package.json` |
| 服务/事件契约 | 运行时 `cordis_inspect_list` / `cordis_inspect_query` |
| 官方 monorepo 结构 | `github.com/deepseek-ai/deepseek-harness` → `packages/<domain>/<pkg>` |
| 本插件实例 | `github.com/Sdongmaker/vpshub`(src/ 正式包 + examples/dynamic-plugin/ 动态版) |
| 环境事实速查 | `dsh-shell/lib/types/types.d.ts`(ShellRunResult)、`dsh-cordis-host-runner`(RPC 校验) |

---

*本指南由 `dsh-vps-hub` 的真实开发-测试-发布过程提炼;踩坑条目均来自线上实测报错,不是推测。*
