/**
 * lan-access bootstrap half — declares Host ownership for a trusted remote
 * browser so Host-backed settings stay available off a loopback page.
 *
 * Why this still exists: `client-connection` derives
 * `isLoopback: transport?.ownsHost === true`, and client plugins read that fact
 * to decide whether the page may reach Host-backed surfaces — the settings
 * document controller, for one, is created only when it is true. A page served
 * from a LAN or Tailscale address is not loopback by hostname, so without this
 * signal those surfaces stay empty even after authentication succeeds.
 *
 * The bootstrap is injected as the first script in `<head>`, before the
 * `__DSH_BOOT__` manifest and the shell entry bundle, through the webserver's
 * index-tap extension point. It declares ownership while keeping the ordinary
 * HTTP `fetch` transport, and leaves a transport supplied by another shell
 * untouched.
 *
 * What this no longer does: polyfill `crypto.randomUUID`. Releases from 0.2.1
 * mint UUIDs through `@deepseek-ai/dsh-util-crypto`, which is built on
 * `crypto.getRandomValues` — available on insecure origins — so a plain-HTTP
 * LAN origin needs no patch to render sessions and models.
 *
 * Removing this row from cordis.patch.yml restores the original page exactly
 * (`ctx.effect` disposes the tap on row teardown).
 */

const BOOTSTRAP_SCRIPT =
  '<script>(function(){var g=globalThis;'
  + 'if(!g.__DSH_TRANSPORT__){g.__DSH_TRANSPORT__={'
  + 'ownsHost:true,fetch:function(input,init){return g.fetch(input,init)}}}})();</script>'

/** Marker comment so the injected script is greppable in served HTML. */
const MARKER = '<!--lan-access-bootstrap-->'

/**
 * Inject the bootstrap as the first child of `<head>`, so it runs before the
 * boot manifest and the shell entry bundle.
 * @param html - the served index document.
 * @returns the document with the bootstrap, or the input when it has no head.
 */
function injectBootstrap(html) {
  const head = html.indexOf('<head>')
  if (head === -1) return html
  return html.slice(0, head + 6) + MARKER + BOOTSTRAP_SCRIPT + html.slice(head + 6)
}

/**
 * Host plugin body: register the index tap on the webServer service.
 * `inject` holds activation until the webserver row is active — at cold boot
 * this row could otherwise run before webServer exists and silently no-op
 * (hot-mounts into a live tree worked only because the service was already
 * up). A non-web tree never satisfies the dependency, so this row simply
 * stays pending there.
 */
export const inject = ['webServer']

function apply(ctx) {
  ctx.effect(() => ctx.webServer.tapIndex(injectBootstrap), 'lan-access: trusted remote bootstrap')
}

export { BOOTSTRAP_SCRIPT, MARKER, apply, injectBootstrap }
