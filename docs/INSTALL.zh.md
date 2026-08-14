# dsh-vps-hub 安装指南(中文)

> 面向 DSH 用户的完整安装说明:从环境检查到验证、升级、卸载与常见问题。
> 英文概要见 [README.md](../README.md),本指南为中文详细版。

---

## 目录

1. [安装前准备](#1-安装前准备)
2. [方式 A:npm 正式安装(推荐,Agent 工具面)](#2-方式-anpm-正式安装推荐agent-工具面)
3. [方式 B:动态插件(含设置页 UI,会话级)](#3-方式-b动态插件含设置页-ui会话级)
4. [验证安装](#4-验证安装)
5. [升级与卸载](#5-升级与卸载)
6. [常见问题 FAQ](#6-常见问题-faq)
7. [安全注意事项](#7-安全注意事项)

---

## 1. 安装前准备

逐项检查,全部满足再继续:

```bash
# ① ssh/scp 可用(macOS / Linux 自带)
which ssh scp

# ② 你的 DSH profile 目录(web 模式)
ls -d ~/.dsh/profiles/web

# ③ 至少一台服务器的 SSH 登录方式
#    密钥:确认私钥存在且权限正确
ls -l ~/.ssh/id_ed25519            # 应为 -rw-------(0600)
#    或密码:安装后按会话提供(仅存内存)

# ④ DSH 版本
dsh --version                      # 需要 0.1.0-rc.x
```

| 检查项 | 要求 | 说明 |
|---|---|---|
| 系统 | macOS / Linux | Windows 暂不支持 |
| `ssh`/`scp` | 在 PATH 中 | 系统自带 |
| DSH | 0.1.0-rc.x,web profile | 组合层挂载需要 `cordis.patch.yml` |
| 服务器认证 | 密钥 或 会话密码 | 密码不落盘,重启后需重新提供 |

---

## 2. 方式 A:npm 正式安装(推荐,Agent 工具面)

### 第 1 步:安装包

```bash
cd ~/.dsh/profiles/web             # 换成你的 profile 目录
npm install dsh-vps-hub
# 或: pnpm add dsh-vps-hub
```

成功标志:package.json 依赖中出现 `dsh-vps-hub`。

### 第 2 步:挂载到组合层

编辑 profile 根目录的 **`cordis.patch.yml`**(不是 `cordis.yml`!):

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: vps-hub
      name: 'dsh-vps-hub'
      # 全部可选;缺省即可用
      config:
        # dataFile: '~/.dsh/vpshub-targets.json'   # 台账路径覆盖
        # maxOutputBytes: 100000                    # 单条命令输出上限(字节)
        # connectTimeoutSec: 8                      # ssh/scp 连接超时(秒)
```

> **为什么改 patch 文件?** profile 根 `cordis.yml` 是空列表,由多层补丁组合而成:
> 官方 bundle(dsh-base / dsh-web-app)→ 你的 `cordis.patch.yml`。编辑补丁文件即可,不要动根文件。

### 第 3 步:重启并确认加载

- 重启 DSH(或触发 HMR 热重载);
- 日志无 `Cannot find package 'dsh-vps-hub'` 类报错即加载成功。

---

## 3. 方式 B:动态插件(含设置页 UI,会话级)

不需要安装 npm 包,在当前会话内加载已验证的示例:

1. 打开仓库目录 `examples/dynamic-plugin/`,里面有:
   - `host.js` —— Host 半:8 个工具 + 设置页 RPC;
   - `client.js` —— Client 半:Settings → VPS Hub 页面 UI;
   - `README.md` —— 组装说明。
2. 在 DSH 会话中调用 `cordis_define`:
   - `code.host`:粘贴 `host.js` 中 `apply()` 的函数体,外层包成
     `return { name: 'vps-hub', apply: <函数体> }`;
   - `code.client`:同上粘贴 `client.js` 的函数体,包成
     `return { name: 'vps-hub-ui', apply: <函数体> }`。
3. 调用 `cordis_run` 激活;**首次需在 UI 中批准 client 半部分**(一次性)。
4. 打开 **设置 → VPS Hub**:看到服务器台账页面即成功;8 个 `vps_*` 工具同时对本会话生效。

| | 方式 A(npm) | 方式 B(动态插件) |
|---|---|---|
| 持久性 | 进程级,重启保留 | 会话级,重启消失 |
| Agent 工具 | ✅ 8 个 | ✅ 8 个 |
| 设置页 UI | ❌(后续版本) | ✅ |
| 安装动作 | 改 profile 配置 | 会话内 define/run |
| 数据文件 | 共用 `~/.dsh/vpshub-targets.json` | 同一文件,互通 |

---

## 4. 验证安装

方式 A 安装后,任选其一:

```bash
# ① 会话验证:对 Agent 说"列出我的服务器",应返回台账或空列表
# ② 冒烟测试(需克隆仓库):
node examples/smoke.mjs
# ③ 台账文件(首次 vps_add / vps_test 后生成):
ls -l ~/.dsh/vpshub-targets.json
```

端到端快检:

```
你 →  "导入我的 ssh config"          → vps_import_ssh_config 返回候选
你 →  "把 hk-prod 加进来(并测试连接)" → vps_add { alias, test: true } 返回 ok
你 →  "在这台上跑 hostname"          → vps_exec 返回主机名
```

预期:连接类命令输出 `ok: true` 或 `exitCode: 0`;台账出现服务器记录(含 `lastSeenAt`)。

---

## 5. 升级与卸载

```bash
# 升级
npm update dsh-vps-hub
# 或显式: npm install dsh-vps-hub@latest

# 卸载
npm uninstall dsh-vps-hub
# 并删除 cordis.patch.yml 中的挂载行(- id: vps-hub ...)
```

卸载不会删除台账文件 `~/.dsh/vpshub-targets.json`(需要时手动清理);重启后内存中的密码自动清空。

---

## 6. 常见问题 FAQ

**Q1:连接失败,提示 `Permission denied (publickey)`**
- 确认 `identityFile` 路径正确、权限为 0600;密钥与服务器 authorized_keys 匹配;
- 若服务器只允许密码登录,在 `vps_test`/`vps_exec` 传入 `password`(仅内存)。

**Q2:密码认证不生效 / 不弹提示**
- 密码仅存内存:DSH 重启后需重新提供(在 `vps_add` 或 `vps_test { password }`);
- 确认系统 OpenSSH ≥ 8.4(`ssh -V`),`SSH_ASKPASS_REQUIRE=force` 依赖它。

**Q3:`~/.ssh/config` 导入结果为空**
- 检查 config 是否有 `Host` 块;`Include` 文件是否存在;
- 通配 `Host *` 块只作为字段兜底,不会产生候选;`Match` 块暂不支持(手动 `vps_add` 补录)。

**Q4:首次连接要求确认 host key 而卡住**
- 插件默认 `StrictHostKeyChecking=accept-new`,首次自动接受;若全局配置覆盖了它,在目标上删除旧 known_hosts 条目或手动 `ssh-keyscan` 预置。

**Q5:Windows 能用吗**
- 暂不支持(依赖系统 `ssh`/`scp`;Windows 版计划中)。

**Q6:设置页在哪(方式 B)**
- 侧栏底部 **设置(Settings)→ VPS Hub**(在"Agent 预设"之后);动态插件重启后需重新加载。

**Q7:方式 A 和方式 B 会冲突吗**
- 不会:共用同一台账文件与同一套 `vps_*` 工具名;同会话同时启用会导致工具重名注册失败,二选一即可。

**Q9:加载即崩溃,报 `cannot get property "config" without inject`(Web UI 起不来)**
- 这是 **v0.1.0 的已知缺陷**:插件错误地读取 `ctx.config`(Cordis Guard 拒绝未声明的 ctx 属性,导致整个 Web 进程退出)。
- **修复:升级到 v0.1.1+** —— `npm install dsh-vps-hub@latest`(v0.1.1 改为官方 `apply(ctx, config)` 签名,不再访问 `ctx.config`)。
- 确认版本:`npm ls dsh-vps-hub`。

**Q8:粘贴的密钥保存在哪**
- `~/.dsh/keys/<id>.key`(0600,目录 0700),台账只存路径;删除服务器不会自动删除密钥文件,可手动清理。

---

## 7. 安全注意事项

- 台账只存密钥**路径**;粘贴的密钥内容存 `~/.dsh/keys/`(0600);**密码只存内存,永不落盘**。
- `identityKeyContent`(粘贴密钥)会作为工具参数经过模型调用 —— 条件允许时优先用密钥**路径**。
- 远程执行是强力工具:模型可对已添加服务器执行任意命令;需要确认门槛时配合 DSH 权限/审批层。
- 密钥文件与台账文件请保持 0600;不要将 `~/.npmrc`、`~/.dsh/keys/` 提交进任何仓库。

---

*指南版本:v0.1.0 · 与 npm 包 `dsh-vps-hub@0.1.0` 同步*
