# dsh-vps-hub

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 VPS Hub 插件:在本地维护一份云服务器 SSH 台账,让 Agent 可以**发现、测试、执行命令、传输文件**——对标 [Orca](https://github.com/stablyai/orca) 的 SSH 远程主机管理,但构建在 DSH 的 Agent 平面上。

## 为什么

- **Agent 可发现**:`vps_list` / `vps_import_ssh_config` 让 Agent 直接找到你的服务器,无需重复录入连接信息。
- **零新守护进程**:执行直接调用系统 `ssh` / `scp`(`execFile`,无 shell 拼接),不需要部署 relay 守护进程,也不需要维护 npm SSH 库。
- **密钥永不离开本机**:台账只存 `identityFile` **路径引用**。密钥内容不存储、不传输、绝不进入工具输出。刻意不支持密码认证。

## 存储(对标 Orca 的 SSH 目标模型)

单一 JSON 文档 —— 默认 `$DSH_HOME`/`~/.dsh/vpshub-targets.json`:

```jsonc
{
  "version": 1,
  "targets": [
    {
      "id": "vps-1786641416471-a1b2c3",
      "label": "aliyun-prod",
      "configHost": "orca",            // 从 ~/.ssh/config 导入时的别名
      "host": "1.2.3.4",
      "port": 22,
      "username": "root",
      "identityFile": "~/.ssh/id_ed25519",   // 仅路径
      "source": "ssh-config" | "manual",     // ssh-config 来源随导入同步;manual 永不被覆盖
      "tags": ["aliyun", "prod"],
      "note": "...",
      "lastSeenAt": 1786641416471,
      "createdAt": 1786641416471,
      "updatedAt": 1786641416471
    }
  ],
  "removedTargets": [],               // tombstone,便于干净地重新添加
  "deletedConfigAliases": []          // 删除后抑制重新导入的别名
}
```

`~/.ssh/config` 解析支持 `Include` 展开与 OpenSSH first-match-wins 语义;别名支持 `*`/`?` 通配与 `Host *` 兜底。

## 工具

| 工具 | 用途 |
|---|---|
| `vps_list` | 发现台账服务器;按标签/文本过滤;可选 `withStatus` 连通探测 |
| `vps_import_ssh_config` | 扫描 `~/.ssh/config`(含 Include)列出可导入主机,带 `alreadyInLedger` 标记 |
| `vps_add` | 从 config 别名或手动字段添加服务器;可选保存前 `test` |
| `vps_remove` | 删除服务器,保留 tombstone + 别名抑制 |
| `vps_test` | 非交互连通检测,返回延迟 |
| `vps_exec` | 在服务器上执行一条 shell 命令(输出截断到 100KB) |
| `vps_upload` / `vps_download` | scp 双向文件传输 |

## 安装

插件是 host 平面 Cordis 插件。安装到你的 DSH profile 的 node_modules,然后在 profile 的 `cordis.patch.yml` 加一行:

```bash
# 在 DSH profile 目录(如 ~/.dsh/profiles/web)下
npm install dsh-vps-hub   # 或: pnpm add dsh-vps-hub
```

```yaml
# cordis.patch.yml
- insert:
    - id: vps-hub
      name: 'dsh-vps-hub'
      config:
        # dataFile: '~/.dsh/vpshub-targets.json'   # 可选覆盖
        # maxOutputBytes: 100000                    # 可选
        # connectTimeoutSec: 8                      # 可选
```

重启(HMR 重载)profile 后,直接问 Agent:"列出我的服务器" → `vps_list`;"导入我的 ssh config" → `vps_import_ssh_config`;"在阿里云那台上跑 df -h" → `vps_exec`。

### 动态插件原型

同一能力最初以会话级动态 Cordis 插件(`cordis_define` / `cordis_run`)验证过,现已被本包取代;动态插件路线仍适合在不改动组合层的前提下实验工具面。

## 安全说明

- `BatchMode=yes` 全程非交互;`StrictHostKeyChecking=accept-new` 首次连接自动接受(如需严格 known_hosts 请自行调整)。
- 远程命令以单个 argv 元素传给 `execFile`,远程命令无法注入本地 shell 语法。
- 台账文件原子写入(`0600`)。请照常保持 `identityFile` 权限 `0600`。
- 远程执行是真正的"强力工具":模型可以在你添加的服务器上执行任意命令。如需确认门槛,请配合 DSH 的权限/审批层使用。

## License

MIT
