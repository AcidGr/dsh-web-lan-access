# dsh-web-lan-access
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**English** | [简体中文](README.zh.md)

LAN / remote access support for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI.

## The problem

The Web UI calls `crypto.randomUUID()` in boot-critical paths (RPC id minting, message ids, draft attachments). That Web API exists **only in secure contexts** (HTTPS, or `http://localhost` / `http://127.0.0.1`). When the UI is served over plain HTTP from a non-loopback address — a LAN IP, a Tailscale IP, or a hostname — `crypto.randomUUID` is `undefined`, every RPC throws, and **sessions and models never render**.

Current DSH clients also select Host-backed settings from the browser hostname: a non-loopback page is assigned memory-only settings even after browser authentication succeeds. The Models and plugin settings pages therefore remain unavailable on an otherwise working trusted-host deployment.

## The fix

A host-side plugin that uses the webserver's official index-tap extension point (`webServer.tapIndex`) to inject a small bootstrap as the first script in `<head>`, before the boot manifest and shell entry. The bootstrap:

- supplies an ordinary HTTP transport carrying DSH's `ownsHost` deployment signal, enabling authenticated Host settings from the trusted remote page;
- polyfills `crypto.randomUUID` with an RFC 4122 v4 implementation built on `crypto.getRandomValues`, which **is** available on insecure origins.

The bootstrap leaves a transport supplied by another shell untouched, and the UUID polyfill is a no-op on secure origins.

- No product source modified; fully reversible
- Uses DSH's existing index-tap and client-transport extension points
- Platform-independent (Linux / macOS / Windows / Android)

## Install

### Method 1: Ask your DSH Agent (Easiest 🤖)

Send this repo URL directly to your DSH chat with the instruction:
> "Install this plugin for me: https://github.com/AcidGr/dsh-web-lan-access"

Your DSH Agent will automatically install the package and configure it in the background.

### Method 2: Bundle install via CLI (Recommended)

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

### Method 3: Manual install (no pnpm / offline)

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

2. **MagicDNS hostnames (e.g. `xxx.tailXXXX.ts.net`)** — the fence can't discover hostnames, only IP literals, so add your own names if you want to browse by name instead of IP. Patch the **`web-runtime` row**, whose `trustedHosts` feed *into* the fence computation (`resolveLanTrust` merges them), so your entries stack on top of the auto-discovered IPs:

   ```yaml
   - id: web-runtime
     config:
       trustedHosts:
         - <short-name>            # e.g. myhost — MUST be listed separately!
         - <name>.tailXXXX.ts.net  # full domain
   ```

   Or skip file editing entirely with the repeatable CLI flag (same injection path): `dsh --profile web --trusted-host myhost --trusted-host myhost.tailXXXX.ts.net`. Use one mechanism or the other — a static list replaces the row's default expression, so it will not merge with `--trusted-host`.

   ⚠️ The fence compares the `Host` header **literally**: a MagicDNS short name (`http://myhost:3080`) is *not* the full domain — list the short name on its own line, or every `/api` call returns 403 (page shell loads, sessions/models absent). Tailscale / LAN IP literals need no entry here — they stay covered automatically.

   > ⚠️ Do not retarget this block at the `connection` row: patch layers compose by whole-key replacement in application order (bundle layers first, then your profile's `cordis.patch.yml`), so a plain literal array on `connection.config.trustedHosts` would silently replace the bundle's dynamic fence expression — names would work, but the auto-derived LAN/Tailscale IP trust would vanish. If you truly need `connection`, copy the full concatenation expression from the plugin's bundle patch and append your literals; never write a plain list there.

## Host ownership scope

The transport signal enables every client surface DSH currently associates with owning the Host, not only Models. That includes Host-backed settings and native Host actions such as opening a produced file. Use this plugin only when the authenticated remote browser is meant to operate the agent machine. DSH's Host/Origin fence and browser authentication remain in force; this signal changes the client's capability projection, not request authentication.

Older harness builds that pin privileged methods to loopback on the server will continue returning 403 for those methods. This client bootstrap does not weaken that server-side fence.

## Verify

```sh
curl http://127.0.0.1:3080/ | grep lan-access-polyfill   # must match
```

Then open `http://<server-ip>:3080` from another device — sessions and models must load.

## Security warning

Binding `0.0.0.0` exposes the DSH authentication surface to every reachable interface. `trustedHosts` is an Origin/Host fence, not identity; current DSH builds separately authenticate the browser. Use only on trusted networks, restrict with a firewall (e.g. `ufw allow from 192.168.0.0/16`), or expose through Tailscale or an authenticated reverse proxy. A TLS reverse proxy removes the need for the UUID polyfill but not the remote Host-settings bootstrap.

## Rollback

- Bundle install: `dsh plugin --profile web remove dsh-web-lan-access`
- Manual install: delete the `lan-access` insert block from `cordis.patch.yml`; optionally start without `--host 0.0.0.0`

## License

MIT
