# dsh-web-lan-access

[English](README.md) | **简体中文**

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI 的局域网/远程访问支持插件。

## 问题

Web UI 在启动关键路径上调用 `crypto.randomUUID()`（RPC id 生成、消息 id、草稿附件）。该 Web API **只在安全上下文存在**（HTTPS，或 `http://localhost` / `http://127.0.0.1`）。当界面通过纯 HTTP 从非回环地址（局域网 IP、Tailscale IP、主机名）提供服务时，`crypto.randomUUID` 是 `undefined`，所有 RPC 抛错，**会话和模型完全无法显示**。

当前 DSH 客户端还会根据浏览器主机名选择宿主设置：即使浏览器认证成功，非回环页面仍只分配内存设置。因此，在其他功能正常的 trusted-host 部署中，模型和插件设置页仍不可用。

## 原理

宿主端插件使用 webserver 官方扩展点（`webServer.tapIndex`），在每次返回的 index.html 的 `<head>` 之后、启动清单和 shell 入口之前注入一段 bootstrap。它会：

- 提供普通 HTTP transport 并携带 DSH 的 `ownsHost` 部署信号，让受信任远程页面可以使用通过认证的宿主设置；
- 用 `crypto.getRandomValues`（非安全上下文仍**可用**）补充 RFC 4122 v4 `crypto.randomUUID`。

如果其他 shell 已提供 transport，bootstrap 不会替换它；安全上下文下 UUID polyfill 为空操作。

- 不修改产品源码，完全可逆
- 使用 DSH 现有的 index-tap 和客户端 transport 扩展点
- 跨平台（Linux / macOS / Windows / Android）

## 安装

### 方式一：直接发给你的 DSH（最省心 🤖）

直接在 DSH 网页对话框中把本仓库链接发给 AI，并附上指令：
> “帮我安装这个插件：https://github.com/AcidGr/dsh-web-lan-access”

DSH Agent 会自动在后台执行安装命令并完成配置。

### 方式二：CLI 命令行安装（推荐）

直接从 npm 安装：

```sh
dsh plugin --profile web add dsh-web-lan-access
```

（不走 npm / 本地开发时，可用仓库地址：

```sh
dsh plugin --profile web add github:AcidGr/dsh-web-lan-access
```

）

重启 `dsh web`，浏览器硬刷新。

### 方式三：手动安装（无 pnpm / 离线）

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

插件是**自包含**的：它的 bundle patch 直接把 webserver 的绑定 host 设为 `0.0.0.0`（新版 harness 出于安全**硬性拒绝**命令行 `--host 0.0.0.0`，但 webserver 配置仍接受该值——所以**无需改源码、无需 `--host` 参数**；`--port` 参数照常可用）。它同时会自动扩大 `/api` 信任围栏。

1. **安装插件后正常启动即可**（不带 `--host`）：

   ```sh
   dsh --profile web --port 3080
   ```

   bundle patch 会从本机**当前所有非内部 IPv4**（局域网 `192.168.x`、**Tailscale `100.x`**、VPN 接口）重新推导 `/api` 信任围栏，并合并 `resolveLanTrust` 已有的结果。只要远程接口在 `dsh web` 启动时已就绪（Tailscale 通常开机自启、先于它），**局域网 / Tailscale IP 访问零额外配置**：打开 `http://<服务器IP>:3080` 或 `http://<tailscaleIP>:3080` 即可正常加载会话和模型。

   > 如果你不想让插件接管绑定（例如想保持 127.0.0.1 + 端口转发），把 `webserver` 行覆盖从组合里去掉，改用 socat / rinetd / Tailscale serve 从 `127.0.0.1:3080` 转发端口，并把转发入口地址手动加入 `trustedHosts`。

2. **MagicDNS 主机名（如 `xxx.tailXXXX.ts.net`）**——围栏只能自动发现 IP 字面量，无法发现主机名，所以如果你想像按 IP 那样用名字访问，需手动声明。改 **`web-runtime` 行**：它的 `trustedHosts` 是喂给围栏计算的输入（`resolveLanTrust` 会合并它们），你的条目叠加在自动发现的 IP 之上，是追加语义：

   ```yaml
   - id: web-runtime
     config:
       trustedHosts:
         - <短名>            # 如 myhost —— 必须单独列出！
         - <名称>.tailXXXX.ts.net  # 完整域名
   ```

   或者不改文件，直接用可重复的 CLI 参数（同一条注入路径）：`dsh --profile web --trusted-host myhost --trusted-host myhost.tailXXXX.ts.net`。两种方式二选一——静态列表会替换该行的默认表达式，不会再与 `--trusted-host` 合并。

   ⚠️ 围栏**逐字比对** Host 头：MagicDNS 短名（`http://myhost:3080`）≠ 完整域名，短名必须单独列一行，否则所有 `/api` 请求返回 403（页面壳能开、会话/模型全无）。Tailscale / 局域网 IP 字面量无需在此列出——已自动覆盖。

   > ⚠️ 不要把这段改指向 `connection` 行：patch 层按应用顺序做**整个 key 替换**（各 bundle 层先应用、本文件的层最后应用），直接往 `connection.config.trustedHosts` 写普通数组会静默替换掉 bundle 的动态围栏表达式——名字能访问了，但自动推导的局域网/Tailscale IP 信任就没了。确实需要动 `connection` 时，请照抄插件 bundle 补丁里的完整拼接表达式再追加自己的字面量，不要写纯列表。

## 宿主所有权范围

该 transport 信号会启用 DSH 当前归入“拥有宿主”的全部客户端界面，并非只启用模型页。其中包括宿主持久化设置，以及打开生成文件等宿主原生操作。仅应在已认证的远程浏览器确实用于操作 agent 主机时使用本插件。DSH 的 Host/Origin 围栏和浏览器认证仍然生效；此信号改变的是客户端能力投影，不是请求认证。

旧版 harness 如果仍在服务端把特权方法限制为仅回环，这些方法仍会返回 403。客户端 bootstrap 不会削弱服务端围栏。

## 验证

```sh
curl http://127.0.0.1:3080/ | grep lan-access-polyfill   # 必须有输出
```

再从另一台设备打开 `http://<服务器IP>:3080`——会话和模型应正常加载。

## 安全警告

绑定 `0.0.0.0` 会把 DSH 认证入口暴露到所有可达接口。`trustedHosts` 是 Origin/Host 围栏而非身份认证；当前 DSH 构建会另外认证浏览器。请只在可信网络使用；用防火墙限制网段（如 `ufw allow from 192.168.0.0/16`），或走 Tailscale / 带鉴权的反向代理。TLS 反代可免除 UUID polyfill，但远程宿主设置 bootstrap 仍然需要。

## 回滚

- bundle 安装：`dsh plugin --profile web remove dsh-web-lan-access`
- 手动安装：删掉 `cordis.patch.yml` 里的 `lan-access` insert 块；可选：启动时去掉 `--host 0.0.0.0`

## 许可证

MIT
