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

1. **Bind all interfaces** so other devices can connect:

   ```sh
   dsh --profile web --host 0.0.0.0 --port 3080
   ```

   When bound to `0.0.0.0`, the harness automatically adds every local non-internal IPv4 to the `/api` trust fence (`resolveLanTrust`) — **LAN IP access needs no extra config**.

2. **Domains / remote (e.g. Tailscale)** — add your own authorities to `trustedHosts`:

   ```yaml
   - id: web-runtime
     config:
       trustedHosts:
         - <short-name>            # e.g. myhost — MUST be listed separately!
         - <name>.tailXXXX.ts.net  # full domain
         - 100.x.x.x               # tailnet IP
   ```

   ⚠️ The fence compares the `Host` header **literally**: a MagicDNS short name (`http://myhost:3080`) is *not* the full domain — list the short name on its own line, or every `/api` call returns 403 (page shell loads, sessions/models absent).

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
