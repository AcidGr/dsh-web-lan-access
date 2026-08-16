# dsh-web-lan-access

[English](README.md) | **简体中文**

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI 的局域网/远程访问支持插件。

## 问题

Web UI 在启动关键路径上调用 `crypto.randomUUID()`（RPC id 生成、消息 id、草稿附件）。该 Web API **只在安全上下文存在**（HTTPS，或 `http://localhost` / `http://127.0.0.1`）。当界面通过纯 HTTP 从非回环地址（局域网 IP、Tailscale IP、主机名）提供服务时，`crypto.randomUUID` 是 `undefined`，所有 RPC 抛错，**会话和模型完全无法显示**。

## 原理

宿主端插件使用 webserver 官方扩展点（`webServer.tapIndex`），在每次返回的 index.html 的 `<head>` 之后注入一段 polyfill（基于 `crypto.getRandomValues` 的 RFC 4122 v4 实现——该 API 在非安全上下文**可用**），位置在启动清单和 shell 入口之前。安全上下文下 polyfill 为空操作。

- 不修改产品源码，完全可逆
- 与版本无关（只转换下发的 index.html）
- 跨平台（Linux / macOS / Windows / Android）

## 安装

### 方式一：bundle 安装（推荐）

从 npm 安装：

```sh
dsh plugin --profile web add dsh-web-lan-access
```

（不走 npm / 本地开发时，可用仓库地址：

```sh
dsh plugin --profile web add github:AcidGr/dsh-web-lan-access
```

）

重启 `dsh web`，浏览器硬刷新。

### 方式二：手动安装（无 pnpm / 离线）

```sh
PROFILE="$DSH_HOME/profiles/web"                 # 按实际修改 DSH_HOME 和 profile 名
mkdir -p "$PROFILE/plugins" "$PROFILE/node_modules/@dsh-profile"
cp -r dsh-web-lan-access "$PROFILE/plugins/lan-access"
ln -sfn ../../plugins/lan-access "$PROFILE/node_modules/@dsh-profile/lan-access"
# 在 $PROFILE/cordis.patch.yml 追加：
#   - insert:
#       - id: lan-access
#         name: '@dsh-profile/lan-access'
```

## 使用

插件是**自包含**的：它的 bundle patch 直接把 webserver 的绑定 host 设为 `0.0.0.0`（新版 harness 出于安全**硬性拒绝**命令行 `--host 0.0.0.0`，但 webserver 配置仍接受该值——所以**无需改源码、无需 `--host` 参数**；`--port` 参数照常可用）。

1. **安装插件后正常启动即可**（不带 `--host`）：

   ```sh
   dsh --profile web --port 3080
   ```

   绑定 `0.0.0.0` 后，harness 会自动把本机所有非内部 IPv4 加入 `/api` 信任围栏（`resolveLanTrust`）——**局域网 IP 访问零额外配置**。

   > 如果你不想让插件接管绑定（例如想保持 127.0.0.1 + 端口转发），把 `webserver` 行覆盖从组合里去掉，改用 socat / rinetd / Tailscale serve 从 `127.0.0.1:3080` 转发端口，并把转发入口地址手动加入 `trustedHosts`。

2. **域名/远程（如 Tailscale）**——把**你自己的**入口加进 `trustedHosts`：

   ```yaml
   - id: web-runtime
     config:
       trustedHosts:
         - <短名>            # 如 myhost —— 必须单独列出！
         - <名称>.tailXXXX.ts.net  # 完整域名
         - 100.x.x.x         # tailnet IP
   ```

   ⚠️ 围栏**逐字比对** Host 头：MagicDNS 短名（`http://myhost:3080`）≠ 完整域名，短名必须单独列一行，否则所有 `/api` 请求返回 403（页面壳能开、会话/模型全无）。

## 已知限制：特权 API 方法

未修改的 harness 构建里，一小部分敏感 API 方法（`settings.*`、`credentials.*`、`llm.discoverModels`）**被钉死在仅回环**（`packages/client/connection/src/index.ts` 里的 `isTrustedApiRequest(request, [])`），与 `trustedHosts` 无关。远程来源调用它们会得到 403：聊天/会话/模型仍正常，但**设置页（含插件配置卡片）和凭据界面显示为空/报错**。polyfill 无法改变这一点——这是产品侧的策略。上游一行改动（`isTrustedApiRequest(request, trustedHosts)`）即可让它们跟随部署的 trusted hosts；在那之前，要么本地改这一行，要么这些设置从 `http://127.0.0.1:3080` 上操作。

## 验证

```sh
curl http://127.0.0.1:3080/ | grep lan-access-polyfill   # 必须有输出
```

再从另一台设备打开 `http://<服务器IP>:3080`——会话和模型应正常加载。

## 安全警告

绑定 `0.0.0.0` 后，同一网络内**任何设备**都能无鉴权操作该 agent（`/api` 只是来源围栏，不是登录）。公网 IP 的服务器等于向整个互联网开放。请只在可信网络使用；用防火墙限制网段（如 `ufw allow from 192.168.0.0/16`），或走 Tailscale / 带鉴权的反向代理。走 TLS 反代的话连这个 polyfill 都不需要。

## 回滚

- bundle 安装：`dsh plugin --profile web remove dsh-web-lan-access`
- 手动安装：删掉 `cordis.patch.yml` 里的 `lan-access` insert 块；可选：启动时去掉 `--host 0.0.0.0`

## 许可证

MIT
