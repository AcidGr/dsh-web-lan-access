# dsh-web-lan-access
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**English** | [简体中文](README.zh.md)

LAN / remote access support for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI.

## The problem

The Web UI calls `crypto.randomUUID()` in boot-critical paths (RPC id minting, message ids, draft attachments). That Web API exists **only in secure contexts** (HTTPS, or `http://localhost` / `http://127.0.0.1`). When the UI is served over plain HTTP from a non-loopback address — a LAN IP, a Tailscale IP, or a hostname — `crypto.randomUUID` is `undefined`, every RPC throws, and **sessions and models never render**.

## The fix

A host-side plugin that uses the webserver's official index-tap extension point (`webServer.tapIndex`) to inject a small polyfill (RFC 4122 v4 built on `crypto.getRandomValues`, which **is** available on insecure origins) as the first script in `<head>`, before the boot manifest and the shell entry. On secure origins the polyfill is a no-op.

- No product source modified; fully reversible
- Version-independent (it only transforms the served `index.html`)
- Platform-independent (Linux / macOS / Windows / Android)

## Install

### Bundle install (recommended)

Installed from npm:

```sh
dsh plugin --profile web add dsh-web-lan-access
```

(No npm / local development — point pnpm at the repo instead:

```sh
dsh plugin --profile web add github:AcidGr/dsh-web-lan-access
```
)

Restart `dsh web`, then hard-refresh the browser.

### Manual install (no pnpm / offline)

```sh
PROFILE="$DSH_HOME/profiles/web"                 # adjust DSH_HOME and profile name
mkdir -p "$PROFILE/plugins" "$PROFILE/node_modules/@dsh-profile"
cp -r dsh-web-lan-access "$PROFILE/plugins/lan-access"
ln -sfn ../../plugins/lan-access "$PROFILE/node_modules/@dsh-profile/lan-access"
# append to $PROFILE/cordis.patch.yml:
#   - insert:
#       - id: lan-access
#         name: '@dsh-profile/lan-access'
```

## Usage

The plugin is **self-contained**: its bundle patch sets the webserver bind host to `0.0.0.0` directly (the CLI flag `--host 0.0.0.0` is hard-rejected for safety on newer harness versions, but the webserver config still accepts it — so **no source changes and no `--host` flag are needed**; the CLI `--port` flag still works). It also widens the `/api` trust fence automatically.

1. **Install the plugin, then start normally** — without `--host`:

   ```sh
   dsh --profile web --port 3080
   ```

   The bundle patch re-derives the `/api` trust fence from **every non-internal IPv4** the host currently has — LAN (`192.168.x`), **Tailscale (`100.x`)**, and VPN interfaces — and merges in whatever `resolveLanTrust` already computed. So as long as the remote interface is up when `dsh web` starts (Tailscale usually autostarts first), **LAN and Tailscale IP access need zero extra config**: open `http://<server-ip>:3080` or `http://<tailscale-ip>:3080` and sessions/models load.

   > If you prefer NOT to let the plugin take over the bind host (e.g. you want loopback + a port forward), keep the `webserver` row override out of your tree and instead forward a port (socat / rinetd / Tailscale serve) from `127.0.0.1:3080`, adding the forwarded address to `trustedHosts` manually.

2. **MagicDNS hostnames (e.g. `xxx.tailXXXX.ts.net`)** — the fence can't discover hostnames, only IP literals, so add your own domains if you want to browse by name instead of IP:

   ```yaml
   - id: connection
     config:
       trustedHosts:
         - <short-name>            # e.g. myhost — MUST be listed separately!
         - <name>.tailXXXX.ts.net  # full domain
   ```

   ⚠️ The fence compares the `Host` header **literally**: a MagicDNS short name (`http://myhost:3080`) is *not* the full domain — list the short name on its own line, or every `/api` call returns 403 (page shell loads, sessions/models absent). (Tailscale IPs like `100.x.x.x` are already covered automatically — this block is only for name-based access.)

## Known limitation: privileged API methods

On unmodified harness builds, a small set of sensitive API methods (`settings.*`, `credentials.*`, `llm.discoverModels`) is **pinned to loopback** regardless of `trustedHosts` (`isTrustedApiRequest(request, [])` in `packages/client/connection/src/index.ts`). From a remote origin those calls return 403: chat/sessions/models still work, but the **Settings pages (including the plugin-config cards) and credentials UI show empty/errors**. The polyfill cannot change that — it is a product-side policy. A one-line upstream change (`isTrustedApiRequest(request, trustedHosts)`) makes them follow the deployment's trusted hosts; until then, edit that line locally or manage those settings from `http://127.0.0.1:3080`.

## Verify

```sh
curl http://127.0.0.1:3080/ | grep lan-access-polyfill   # must match
```

Then open `http://<server-ip>:3080` from another device — sessions and models must load.

## Security warning

Binding `0.0.0.0` makes the agent reachable without authentication by **anyone** on the same network (`/api` is an origin fence, not a login). On a server with a public IP this means the whole internet. Use only on trusted networks, restrict with a firewall (e.g. `ufw allow from 192.168.0.0/16`), or expose through Tailscale / an authenticated reverse proxy instead. A TLS reverse proxy also removes the need for this polyfill entirely.

## Rollback

- Bundle install: `dsh plugin --profile web remove dsh-web-lan-access`
- Manual install: delete the `lan-access` insert block from `cordis.patch.yml`; optionally start without `--host 0.0.0.0`

## License

MIT
