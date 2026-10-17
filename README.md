# dsh-web-lan-access
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**English** | [简体中文](README.zh.md)

LAN / remote access support for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI.

Bind every interface with one command, reach the GUI from a LAN IP, a Tailscale IP, or a VPN address, and keep Host-backed settings working on the remote page.

## Compatibility

| dsh | plugin | notes |
|---|---|---|
| **0.2.1-rc.2** | **1.4.x** | current; verified end to end |
| 0.2.0-rc.x | 1.3.x | shipped webserver still accepted `0.0.0.0` |
| ≤ 0.1.7 | 1.3.x | no wildcard ban yet |

Version 1.4.0 is the release that tracks dsh 0.2.1's stricter webserver. See [Why 1.4.0 had to change](#why-140-had-to-change) if you are upgrading from 1.3.x.

## The problem

Three separate things stand between a remote browser and a working GUI:

**1. The listener binds loopback only.** `dsh web` defaults to `127.0.0.1`, and from 0.2.1 the CLI rejects a wildcard host outright:

```
error: --host 0.0.0.0 is an unspecified (wildcard) address, which is not supported:
binding every interface would expose remote code execution to the network
```

**2. The `/api` fence rejects unknown authorities.** Every request must name a loopback host, the listener's own bind literal, or a declared `trustedHosts` entry. A wildcard bind has no literal of its own — `0.0.0.0` matches no request `Host` — so the page shell loads but every `/api` call returns **403** and sessions never appear.

**3. Host-backed settings are gated on `isLoopback`.** `client-connection` derives `isLoopback: transport?.ownsHost === true`, and client plugins consult that fact before reaching Host surfaces. A page served from a LAN or Tailscale address is not loopback by hostname, so the Models and plugin settings pages stay empty even after authentication succeeds.

## The fix

Two small pieces, both reversible.

### A replacement `webserver` row

`lib/webserver.js` subclasses `@deepseek-ai/dsh-host-webserver` and changes exactly two things:

- **`Config`** delegates to the shipped schema and rescues *only* the wildcard rejection. A non-literal host, a port out of range, or a missing port still fail exactly as before — the relaxation is one error message wide.
- **`getOrigin()`** never returns a wildcard origin. The parent builds its URL from the bind address, which would yield `http://0.0.0.0:3080` — an address no browser can dial. A wildcard listener reports loopback instead, and `--public-url` still overrides the advertised root upstream.

Everything else — the service name, routes, index taps, TLS handling, gzip, listener lifecycle — is inherited untouched.

### A `/api` fence widened from the live interface list

The bundle patch derives `trustedHosts` from every non-internal IPv4 the host currently has, so LAN, Tailscale (`100.x`), and VPN addresses are all accepted without per-IP configuration.

### A bootstrap script for Host ownership

Injected as the first script in `<head>`, before the boot manifest and shell entry, through the webserver's official index-tap extension point (`webServer.tapIndex`). It declares `ownsHost: true` while keeping the ordinary HTTP `fetch` transport, and leaves a transport supplied by another shell untouched.

> **What 1.4.0 removed:** the `crypto.randomUUID` polyfill. From 0.2.1 DSH mints UUIDs through `@deepseek-ai/dsh-util-crypto`, which is built on `crypto.getRandomValues` — available on insecure origins — so a plain-HTTP LAN page needs no patch to render. The old polyfill is gone because the bug it worked around no longer exists.

## Why 1.4.0 had to change

Through 1.3.x this plugin worked by writing `host: '0.0.0.0'` into the shipped `webserver` row's config. That stopped working in 0.2.1 for two independent reasons:

1. The webserver's own schema now rejects wildcard addresses, so the row fails validation and the boot aborts with `3 required plugins did not activate`.
2. A patch cannot retarget a row's `name` — app-boot skips any patch whose `name` differs from the target's — so the row could not be swapped for a custom module in place.

1.4.0 therefore disables the shipped row (`disabled: true`, which startup auditing skips) and mounts the subclass under a new id. A second breakage came from the same upgrade: `web-app` no longer provides the `webRuntime` service, so the old `ctx.webRuntime?.trustedHosts` expression threw `cannot get property "webRuntime" without inject`. The fence list is now derived directly from `os.networkInterfaces()`.

## Install

### Method 1: Ask your DSH Agent (Easiest 🤖)

Send this repo URL directly to your DSH chat with the instruction:
> "Install this plugin for me: https://github.com/AcidGr/dsh-web-lan-access"

Your DSH Agent will automatically install the package and configure it in the background.

### Method 2: Bundle install via CLI (Recommended)

From npm:

```sh
dsh plugin --profile web add dsh-web-lan-access
```

From the repo (no npm publish / local development):

```sh
dsh plugin --profile web add github:AcidGr/dsh-web-lan-access
```

Restart `dsh web`, then hard-refresh the browser.

### Method 3: Manual install (no pnpm / offline)

```sh
PROFILE="$DSH_HOME/profiles/web"                 # adjust DSH_HOME and profile name
mkdir -p "$PROFILE/plugins"
cp -r dsh-web-lan-access "$PROFILE/plugins/lan-access"
ln -sfn ../../plugins/lan-access "$PROFILE/node_modules/dsh-web-lan-access"
```

Then add `dsh-web-lan-access` to the profile's `dsh.profile.bundles` in `package.json`. The bundle patch registers its own rows, so no manual `cordis.patch.yml` edit is needed.

## Usage

The plugin is **self-contained**: the bundle patch supplies the bind host, so you do **not** pass `--host` (and must not — the CLI still rejects `0.0.0.0`). `--port`, `--tls-cert`, `--tls-key`, and `--public-url` all still work.

1. **Install the plugin, then start normally:**

   ```sh
   dsh --profile web --port 3080
   ```

   The patch derives the `/api` fence from **every non-internal IPv4** the host currently has — LAN (`192.168.x`), **Tailscale (`100.x`)**, and VPN interfaces. As long as the remote interface is up when `dsh web` starts, **LAN and Tailscale IP access need zero extra config**: open `http://<server-ip>:3080` or `http://<tailscale-ip>:3080` and sessions and models load.

   > If you would rather not let the plugin take over the bind host (for example you want loopback plus a port forward), remove the `dsh-web-lan-access` bundle and forward a port (socat / rinetd / `tailscale serve`) from `127.0.0.1:3080`, adding the forwarded address to `trustedHosts` manually.

2. **MagicDNS hostnames (e.g. `xxx.tailXXXX.ts.net`)** — the fence discovers IP literals only, never hostnames. Add your own names when you browse by name rather than by IP, using the repeatable CLI flag:

   ```sh
   dsh --profile web --trusted-host myhost --trusted-host myhost.tailXXXX.ts.net
   ```

   Or replace the `connection` row's `trustedHosts` with a literal list that still includes the interface addresses:

   ```yaml
   - id: connection
     config:
       trustedHosts:
         - <short-name>            # e.g. myhost — MUST be listed separately!
         - <name>.tailXXXX.ts.net  # full domain
         - 192.168.1.10            # keep your IPs; a literal list replaces the
         - 100.64.0.5              # derived expression entirely
   ```

   ⚠️ The fence compares the `Host` header **literally**: a MagicDNS short name (`http://myhost:3080`) is *not* the full domain — list the short name on its own line, or every `/api` call returns 403 (page shell loads, sessions and models absent).

   > ⚠️ A literal list on `connection.config.trustedHosts` **replaces** the bundle's derived expression rather than merging with it. Either keep the derived expression and add names with `--trusted-host`, or spell out every IP you need. Do not mix the two.

## Host ownership scope

The transport signal enables every client surface DSH associates with owning the Host, not only Models. That includes Host-backed settings and native Host actions such as opening a produced file. Use this plugin only when the authenticated remote browser is meant to operate the agent machine. DSH's Host/Origin fence and browser authentication remain in force; this signal changes the client's capability projection, not request authentication.

Older harness builds that pin privileged methods to loopback on the server continue returning 403 for those methods. This client bootstrap does not weaken that server-side fence.

## Verify

```sh
# 1. the bootstrap is injected
curl -s http://127.0.0.1:3080/ -b <cookie> | grep lan-access-bootstrap

# 2. every interface is listening (0.0.0.0 in the address column)
ss -ltnp | grep 3080

# 3. the fence admits your interface IPs and refuses anything else
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: 100.64.0.5:3080" http://127.0.0.1:3080/api  # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: evil.example:3080" http://127.0.0.1:3080/api  # 403
```

`401` means the fence admitted the authority and only the session cookie is missing — that is the expected result for a trusted IP without a browser session. `403` means the authority was rejected. Then open `http://<server-ip>:3080` from another device: sessions and models must load.

## Security warning

Binding `0.0.0.0` exposes the DSH authentication surface to **every** reachable interface, including addresses you may not have considered — container bridges, VPN tunnels, and any other network the host is attached to. `trustedHosts` is an Origin/Host fence, not identity; DSH separately authenticates the browser.

This plugin deliberately relaxes a restriction the DSH maintainers added on purpose:

> binding every interface would expose remote code execution to the network

Use it only on trusted networks, restrict the port with a firewall (e.g. `ufw allow from 192.168.0.0/16`), or front it with Tailscale or an authenticated reverse proxy. If a single interface is enough, prefer plain `dsh web --host <ip>` — it needs no plugin, and the fence auto-trusts the bind literal.

Because this plugin depends on the webserver's schema and URL-building internals, a future DSH release may break it again. Check the compatibility table before upgrading.

## Rollback

- Bundle install: `dsh plugin --profile web remove dsh-web-lan-access`
- Manual install: remove `dsh-web-lan-access` from `dsh.profile.bundles`; the bundle patch's rows disappear with it and the shipped loopback-only `webserver` takes over again.

## Development

```sh
node --test        # 9 tests, no dependencies beyond the linked dsh packages
```

`lib/webserver.js` needs `@deepseek-ai/dsh-host-webserver` resolvable from the package root. When developing outside a profile, link it once:

```sh
mkdir -p node_modules/@deepseek-ai
ln -sfn "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-webserver" \
        node_modules/@deepseek-ai/dsh-host-webserver
```

## License

MIT
