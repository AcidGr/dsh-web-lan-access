# dsh-web-lan-access

[English](README.md) | **简体中文**

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI 的局域网/远程访问支持插件。

一条命令绑定所有网口，从局域网 IP、Tailscale IP 或 VPN 地址访问界面，同时保持远程页面上的宿主设置可用。

## 兼容性

| dsh | 插件 | 说明 |
|---|---|---|
| **0.2.1-rc.2** | **1.4.x** | 当前版本，已端到端验证 |
| 0.2.0-rc.x | 1.3.x | 当时的 webserver 仍接受 `0.0.0.0` |
| ≤ 0.1.7 | 1.3.x | 尚未加入通配地址限制 |

1.4.0 是针对 dsh 0.2.1 收紧 webserver 的版本。从 1.3.x 升级请先看[为什么 1.4.0 必须改架构](#为什么-140-必须改架构)。

## 问题

远程浏览器要正常工作，中间隔着三件事：

**1. 监听只绑回环。** `dsh web` 默认绑 `127.0.0.1`，而从 0.2.1 起 CLI 直接拒绝通配地址：

```
error: --host 0.0.0.0 is an unspecified (wildcard) address, which is not supported:
binding every interface would expose remote code execution to the network
```

**2. `/api` 围栏拒绝未知权威。** 每个请求的 Host 必须是回环、监听器自身的绑定字面量，或已声明的 `trustedHosts` 条目。通配绑定没有自己的字面量——`0.0.0.0` 匹配不上任何请求 Host——于是页面壳能加载，但所有 `/api` 请求返回 **403**，会话永远出不来。

**3. 宿主设置受 `isLoopback` 门控。** `client-connection` 由 `isLoopback: transport?.ownsHost === true` 推导该标志，客户端插件据此决定能否访问宿主面。从局域网或 Tailscale 地址打开的页面按主机名不是回环，所以即使认证成功，模型页和插件设置页仍然是空的。

## 原理

两块小改动，都可逆。

### 替换 `webserver` 行

`lib/webserver.js` 继承 `@deepseek-ai/dsh-host-webserver`，只改两处：

- **`Config`** 委托给原版 schema，仅豁免通配地址那一条拒绝。非字面量 host、端口越界、缺端口仍然照原样失败——放宽范围只有一条错误信息那么宽。
- **`getOrigin()`** 绝不返回通配 origin。父类用绑定地址拼 URL，`0.0.0.0` 会拼出 `http://0.0.0.0:3080`——浏览器根本拨不通。通配监听改为报告回环地址，而 `--public-url` 仍会在上层覆盖对外宣告的根地址。

其余全部原样继承：服务名、路由、index tap、TLS、gzip、监听生命周期。

### 从实时网卡列表扩宽 `/api` 围栏

bundle patch 从本机当前所有非内部 IPv4 推导 `trustedHosts`，局域网、Tailscale（`100.x`）、VPN 地址全部接受，无需逐 IP 配置。

### 注入宿主所有权 bootstrap

通过 webserver 官方 index-tap 扩展点（`webServer.tapIndex`），在 `<head>` 的第一个脚本位置注入，早于启动清单和 shell 入口。它声明 `ownsHost: true` 并保留普通 HTTP `fetch` transport；如果其他 shell 已提供 transport，则不会替换。

> **1.4.0 移除了什么：** `crypto.randomUUID` polyfill。从 0.2.1 起 DSH 通过 `@deepseek-ai/dsh-util-crypto` 生成 UUID，它基于 `crypto.getRandomValues`（非安全上下文可用），所以纯 HTTP 的局域网页面已无需补丁即可渲染。旧 polyfill 所绕过的 bug 已不存在。

## 为什么 1.4.0 必须改架构

1.3.x 及更早版本的做法是把 `host: '0.0.0.0'` 写进原版 `webserver` 行的 config。0.2.1 让这个做法因两个独立原因失效：

1. webserver 自己的 schema 现在拒绝通配地址，该行校验失败，启动直接中止并报 `3 required plugins did not activate`。
2. patch 无法改目标的 `name`——app-boot 会跳过任何 `name` 与目标不符的补丁——所以无法原地把该行换成自定义模块。

因此 1.4.0 禁用原版行（`disabled: true`，启动审计会跳过），并用新 id 挂载子类。同一轮升级还带来第二处损坏：`web-app` 不再提供 `webRuntime` 服务，旧表达式 `ctx.webRuntime?.trustedHosts` 抛 `cannot get property "webRuntime" without inject`。现在围栏列表直接由 `os.networkInterfaces()` 推导。

## 安装

### 方式一：直接发给你的 DSH（最省心 🤖）

直接在 DSH 网页对话框中把本仓库链接发给 AI，并附上指令：
> “帮我安装这个插件：https://github.com/AcidGr/dsh-web-lan-access”

DSH Agent 会自动在后台执行安装命令并完成配置。

### 方式二：CLI 命令行安装（推荐）

从 npm 安装：

```sh
dsh plugin --profile web add dsh-web-lan-access
```

不走 npm / 本地开发，用仓库地址：

```sh
dsh plugin --profile web add github:AcidGr/dsh-web-lan-access
```

重启 `dsh web`，浏览器硬刷新。

### 方式三：手动安装（无 pnpm / 离线）

```sh
PROFILE="$DSH_HOME/profiles/web"                 # 按实际修改 DSH_HOME 和 profile 名
mkdir -p "$PROFILE/plugins"
cp -r dsh-web-lan-access "$PROFILE/plugins/lan-access"
ln -sfn ../../plugins/lan-access "$PROFILE/node_modules/dsh-web-lan-access"
```

然后在 profile 的 `package.json` 里把 `dsh-web-lan-access` 加入 `dsh.profile.bundles`。bundle patch 会自行注册所需行，无需手改 `cordis.patch.yml`。

## 使用

插件是**自包含**的：bundle patch 已提供绑定 host，所以你**不要**传 `--host`（也不能传——CLI 依然拒绝 `0.0.0.0`）。`--port`、`--tls-cert`、`--tls-key`、`--public-url` 全部照常可用。

1. **安装插件后正常启动即可：**

   ```sh
   dsh --profile web --port 3080
   ```

   patch 会从本机**当前所有非内部 IPv4**（局域网 `192.168.x`、**Tailscale `100.x`**、VPN 接口）推导 `/api` 信任围栏。只要远程接口在 `dsh web` 启动时已就绪，**局域网 / Tailscale IP 访问零额外配置**：打开 `http://<服务器IP>:3080` 或 `http://<tailscaleIP>:3080` 即可正常加载会话和模型。

   > 如果你不想让插件接管绑定（例如想保持 127.0.0.1 + 端口转发），把 `dsh-web-lan-access` 从 bundles 里去掉，改用 socat / rinetd / `tailscale serve` 从 `127.0.0.1:3080` 转发端口，并把转发入口地址手动加入 `trustedHosts`。

2. **MagicDNS 主机名（如 `xxx.tailXXXX.ts.net`）**——围栏只能自动发现 IP 字面量，无法发现主机名。想按名字访问时用可重复的 CLI 参数补上：

   ```sh
   dsh --profile web --trusted-host myhost --trusted-host myhost.tailXXXX.ts.net
   ```

   或者把 `connection` 行的 `trustedHosts` 换成字面量列表，并保留你需要的网卡地址：

   ```yaml
   - id: connection
     config:
       trustedHosts:
         - <短名>            # 如 myhost —— 必须单独列出！
         - <名称>.tailXXXX.ts.net  # 完整域名
         - 192.168.1.10            # 保留你的 IP：字面量列表会完全替换
         - 100.64.0.5              # 掉推导表达式
   ```

   ⚠️ 围栏**逐字比对** Host 头：MagicDNS 短名（`http://myhost:3080`）≠ 完整域名，短名必须单独列一行，否则所有 `/api` 请求返回 403（页面壳能开、会话/模型全无）。

   > ⚠️ 往 `connection.config.trustedHosts` 写纯列表是**替换**而非合并 bundle 的推导表达式。要么保留推导表达式并用 `--trusted-host` 追加名字，要么把你需要的每个 IP 都写全。不要混用。

## 宿主所有权范围

该 transport 信号会启用 DSH 当前归入“拥有宿主”的全部客户端界面，并非只启用模型页。其中包括宿主持久化设置，以及打开生成文件等宿主原生操作。仅应在已认证的远程浏览器确实用于操作 agent 主机时使用本插件。DSH 的 Host/Origin 围栏和浏览器认证仍然生效；此信号改变的是客户端能力投影，不是请求认证。

旧版 harness 如果仍在服务端把特权方法限制为仅回环，这些方法仍会返回 403。客户端 bootstrap 不会削弱服务端围栏。

## 验证

```sh
# 1. bootstrap 已注入
curl -s http://127.0.0.1:3080/ -b <cookie> | grep lan-access-bootstrap

# 2. 所有网口都在监听（地址列为 0.0.0.0）
ss -ltnp | grep 3080

# 3. 围栏放行你的网卡 IP、拒绝其他
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: 100.64.0.5:3080" http://127.0.0.1:3080/api  # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: evil.example:3080" http://127.0.0.1:3080/api  # 403
```

`401` 表示围栏放行了该权威、只缺会话 cookie——对没有浏览器会话的可信 IP 而言这是预期结果。`403` 表示权威被拒绝。再从另一台设备打开 `http://<服务器IP>:3080`——会话和模型应正常加载。

## 安全警告

绑定 `0.0.0.0` 会把 DSH 认证入口暴露到**所有**可达接口，包括你未必考虑过的地址——容器网桥、VPN 隧道，以及主机连接的任何其他网络。`trustedHosts` 是 Origin/Host 围栏而非身份认证；DSH 会另外认证浏览器。

本插件是在**有意放宽** DSH 维护者刻意加入的限制：

> binding every interface would expose remote code execution to the network

请只在可信网络使用；用防火墙限制网段（如 `ufw allow from 192.168.0.0/16`），或走 Tailscale / 带鉴权的反向代理。**如果单个网口就够用，优先用原生的 `dsh web --host <ip>`**——它不需要任何插件，而且围栏会自动信任绑定字面量。

由于本插件依赖 webserver 的 schema 与 URL 构造内部实现，未来 DSH 版本可能再次破坏它。升级前请核对兼容性表。

## 回滚

- bundle 安装：`dsh plugin --profile web remove dsh-web-lan-access`
- 手动安装：从 `dsh.profile.bundles` 移除 `dsh-web-lan-access`；bundle patch 的行随之消失，原版仅回环的 `webserver` 重新接管。

## 开发

```sh
node --test        # 9 项测试，除已链接的 dsh 包外无其他依赖
```

`lib/webserver.js` 需要能从包根解析到 `@deepseek-ai/dsh-host-webserver`。在 profile 外开发时链接一次：

```sh
mkdir -p node_modules/@deepseek-ai
ln -sfn "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-webserver" \
        node_modules/@deepseek-ai/dsh-host-webserver
```

## 许可证

MIT
