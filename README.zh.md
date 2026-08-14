# dsh-vps-hub

**[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 VPS Hub 插件** —— 在本地维护云服务器 SSH 台账,让 Agent 能够**发现、测试、执行命令、传输文件**,并提供可选的**设置页 UI**,对标 [Orca](https://github.com/stablyai/orca) 的 SSH 远程主机管理体验。

| | |
|---|---|
| **Agent 工具** | `vps_list` `vps_import_ssh_config` `vps_add` `vps_remove` `vps_test` `vps_exec` `vps_upload` `vps_download` |
| **设置页 UI** | 可选 —— 设置 → "VPS Hub" 页面(服务器卡片、测试连接、`~/.ssh/config` 别名预填表单、删除) |
| **存储** | 单一 JSON 台账,Orca 风格:`source: ssh-config \| manual`、删除 tombstone、别名抑制 |
| **认证** | 密钥路径 · 粘贴密钥内容(私有保存到 `~/.dsh/keys`,0600)· 密码(仅内存,对标 Orca) |
| **代理** | 每台服务器支持 ProxyJump 与 ProxyCommand |

---

## 为什么

- **Agent 可发现**:`vps_list` / `vps_import_ssh_config` 让 Agent 直接找到你的服务器,无需重复录入连接信息;`vps_exec` / `vps_upload` / `vps_download` 让它可以实际操作(部署、巡检、看日志、传文件)。
- **Orca 式管理**:设置页对标 Orca 的 `Settings → SSH` —— 从 `~/.ssh/config`(支持 Include 展开、`*`/`?` 通配、`Host *` 兜底)选一台主机即可自动预填表单;已保存的主机带"已在台账"标记。
- **零新守护进程**:执行直接调用系统 `ssh` / `scp`。正式包用 `execFile`(无 shell 拼接);动态插件版用 DSH shell 服务。
- **密钥留在本机**:台账只存 `identityFile` **路径引用**;粘贴的密钥**内容**写入 `~/.dsh/keys` 私有文件(0600)并以路径引用 —— 绝不存入台账。
- **密码永不落盘**(对标 Orca):密码仅存在于进程内存(插件生命周期内),通过 `SSH_ASKPASS` 协议经子进程环境交给 `ssh` —— 不进 argv、不进文件,重启即失。
- **代理支持**:每台服务器可带 ProxyJump(`-J`)与 ProxyCommand,覆盖跳板机与 SOCKS/HTTP 代理。

---

## 安装

### 方式 A —— 正式安装(推荐,Agent 工具面)

插件是 host 平面 Cordis 插件。安装到 DSH profile 的 `node_modules`,然后在 profile 的 `cordis.patch.yml` 加一行。

```bash
# 在 DSH profile 目录下(如 ~/.dsh/profiles/web)
npm install dsh-vps-hub
# 或: pnpm add dsh-vps-hub
```

```yaml
# cordis.patch.yml(profile 根目录,如 ~/.dsh/profiles/web/cordis.patch.yml)
- insert:
    - id: vps-hub
      name: 'dsh-vps-hub'
      config:
        # dataFile: '~/.dsh/vpshub-targets.json'   # 可选:台账路径覆盖
        # maxOutputBytes: 100000                    # 可选:输出上限
        # connectTimeoutSec: 8                      # 可选:连接超时
```

重启(HMR 重载)profile,Agent 即获得 8 个 `vps_*` 工具。

> **为什么改 `cordis.patch.yml` 而不是 `cordis.yml`?** profile 根 `cordis.yml` 是
> 一个空列表,由补丁层组合而成 —— 请编辑补丁文件,不要动根文件。

### 方式 B —— 动态插件(增加设置页 UI,会话级)

想要 **设置 → VPS Hub 页面** 而暂不安装包(或先试用 UI),可加载已验证的示例动态插件:

1. 打开 `examples/dynamic-plugin/` —— `host.js`(工具 + RPC)与 `client.js`(设置页 UI)。
2. 调用 `cordis_define`:把 `host.js` 中 `apply()` 的函数体粘贴进 `code.host`(`return { name: 'vps-hub', apply: <函数体> }`),把 `client.js` 的函数体粘贴进 `code.client`(`return { name: 'vps-hub-ui', apply: <函数体> }`)。
3. `cordis_run` 并批准 client 半部分。
4. 打开 **设置 → VPS Hub** —— 8 个工具同时在本会话生效。

动态插件是会话级的:DSH 重启后消失(台账文件保留)。完整说明见 [`examples/dynamic-plugin/README.md`](examples/dynamic-plugin/README.md)。

### 环境要求

- macOS / Linux(需要系统 `ssh`、`scp`;暂不支持 Windows)
- DSH 0.1.0-rc.x(web profile)
- 私钥认证(刻意不支持密码认证)

---

## 快速开始

安装后直接对 Agent 说:

| 你说 | Agent 执行 |
|---|---|
| "列出我的服务器" | `vps_list` |
| "导入我的 ssh config" | `vps_import_ssh_config` |
| "把 ssh config 里的 hk-prod 加进来" | `vps_add { alias: "hk-prod" }` |
| "阿里云那台在线吗?" | `vps_test { id }` |
| "在阿里云上跑 df -h" | `vps_exec { id, command: "df -h" }` |
| "把 app.tar.gz 传到 OVH 那台" | `vps_upload { id, localPath, remotePath }` |
| "用我粘贴的这把密钥加一台 VPS" | `vps_add { host, username, identityKeyContent: "-----BEGIN …" }` |
| "用密码测试那台机器 …" | `vps_test { id, password }`(或 `vps_add` 时设置,仅内存) |

## 工具

| 工具 | 用途 |
|---|---|
| `vps_list` | 列出台账服务器(不含密钥内容);按标签/文本过滤;可选 `withStatus` 连通探测(逐台返回延迟) |
| `vps_import_ssh_config` | 扫描 `~/.ssh/config`(含 Include)列出可导入主机,带 `alreadyInLedger` 标记 |
| `vps_add` | 从 config 别名或手动字段添加(主机/端口/用户/密钥路径/粘贴密钥/密码/跳板/代理命令);可选保存前 `test` |
| `vps_remove` | 删除服务器,保留 tombstone + 别名抑制,便于干净地重新添加 |
| `vps_test` | 非交互连通检测(可选 `password`),返回延迟;更新 `lastSeenAt` |
| `vps_exec` | 在服务器上执行一条 shell 命令(可选 `password`;输出默认截断到 100KB) |
| `vps_upload` / `vps_download` | scp 双向文件传输(可选 `password`) |

## 存储

单一 JSON 文档 —— 默认 `$DSH_HOME` / `~/.dsh/vpshub-targets.json`(可用 `dataFile` 覆盖):

```jsonc
{
  "version": 1,
  "targets": [
    {
      "id": "vps-1786641416471-a1b2c3",
      "label": "aliyun-prod",
      "configHost": "orca",                 // 从 ~/.ssh/config 导入时的别名
      "host": "1.2.3.4",
      "port": 22,
      "username": "root",
      "identityFile": "~/.ssh/id_ed25519",  // 仅路径
      "source": "ssh-config" | "manual",    // ssh-config 来源随导入刷新;manual 永不被覆盖
      "tags": ["aliyun", "prod"],
      "note": "...",
      "lastSeenAt": 1786641416471,
      "createdAt": 1786641416471,
      "updatedAt": 1786641416471
    }
  ],
  "removedTargets": [],        // tombstone,便于干净地重新添加
  "deletedConfigAliases": []   // 删除后抑制重新导入的别名
}
```

与 Orca 的 SSH 目标模型(`orca-data.json`)同构:`ssh-config` 来源的目标每次导入刷新,`manual` 目标永不被覆盖;删除主机时记录 tombstone + 别名抑制,重新添加保持干净。

## 安全说明

- 密钥认证全程非交互(`BatchMode=yes`);密码认证使用 `NumberOfPasswordPrompts=1` + `SSH_ASKPASS_REQUIRE=force`。两者均用 `StrictHostKeyChecking=accept-new`(严格 known_hosts 请改为 `yes`)。
- 密码仅存内存、永不落盘;askpass 桥接脚本位于 `~/.dsh/.vpshub-askpass.sh`(0700),从子进程环境读取密码。重启 DSH 即清空全部缓存密码。
- **粘贴密钥是权衡**:`identityKeyContent` 会经过模型调用(工具参数),条件允许时优先使用密钥**路径**。保存的内容位于 `~/.dsh/keys/<id>.key`(0600,目录 0700),绝不回显。
- 正式包把远程命令作为**单个 argv 元素**传给 `execFile` —— 远程命令无法注入本地 shell 语法。
- 台账文件原子写入,权限 `0600`。请照常保持 `identityFile` 权限 `0600`。
- 远程执行是真正的"强力工具":模型可以在你添加的服务器上执行任意命令。如需确认门槛,请配合 DSH 的权限/审批层使用。

## 项目结构

```
dsh-vps-hub/
├── src/
│   └── index.js              # 正式包 host 插件(execFile 实现)
├── examples/
│   ├── cordis.patch.yml      # profile 挂载示例(方式 A)
│   ├── dynamic-plugin/       # 已验证的会话插件:设置页 UI + 工具(方式 B)
│   │   ├── README.md
│   │   ├── host.js
│   │   └── client.js
│   └── smoke.mjs             # 冒烟测试(node smoke.mjs,针对真实台账)
├── package.json
├── README.md / README.zh.md
└── LICENSE
```

## 开发与测试

```bash
npm install          # 开发依赖(zod、@deepseek-ai/dsh-tools)
node --check src/index.js
node examples/smoke.mjs   # 在假 ctx 上注册工具、读取真实台账、执行只读 vps_exec
```

核心逻辑已在真实 DSH 会话中对真实服务器做过端到端验证:导入 → 添加 → 列表+状态 → 测试 → 执行 → 上传 → 下载 → 删除,以及设置页 UI 全流程(发现 → 测试连接 → 添加 → 删除 → 别名预填)。

## 已知限制

- 暂不支持 Windows(依赖系统 `ssh`/`scp`)。
- 密码认证经 `SSH_ASKPASS` 支持,但密码仅存内存:DSH 重启后需重新输入(Orca 同样如此)。
- 设置页 UI 目前以动态插件示例形式提供,尚未打进 npm 包 —— 正式包内置 client 需要 Typert Remote 装饰器管线(TypeScript 构建),计划后续版本实现。
- `~/.ssh/config` 解析支持 `Include`、`*`/`?` 通配与 `Host *` 兜底;更复杂的 OpenSSH 语义(如 `Match`、hostname 链式解析)未实现 —— 此类主机可用 `vps_add` 显式字段手动添加。

## License

MIT
