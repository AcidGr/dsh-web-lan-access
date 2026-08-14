/**
 * lan-access node half — LAN / remote access support for the Web GUI.
 *
 * Why this exists: the browser UI calls crypto.randomUUID() in boot-critical
 * paths (RPC id minting, message ids, draft attachments). That Web API exists
 * only in secure contexts (HTTPS, or http://localhost / http://127.0.0.1),
 * so on a plain-HTTP origin reached through a LAN or Tailscale IP it is
 * undefined and every RPC throws — sessions and models never render.
 *
 * This plugin uses the webserver's official index-tap extension point to
 * inject a small polyfill (RFC 4122 v4 built on crypto.getRandomValues, which
 * IS available on insecure origins) as the first script in <head>, before the
 * __DSH_BOOT__ manifest and the shell entry bundle. On secure origins the
 * polyfill is a no-op. Removing this row from cordis.patch.yml restores the
 * original page exactly (ctx.effect disposes the tap on row teardown).
 */

const POLYFILL_SCRIPT =
  '<script>(function(){var c=globalThis.crypto;if(!c){try{c=globalThis.crypto={}}catch(e){return}}'
  + 'if(typeof c.randomUUID==="function")return;'
  + 'c.randomUUID=function(){var b=new Uint8Array(16);c.getRandomValues(b);'
  + 'b[6]=b[6]&15|64;b[8]=b[8]&63|128;var h="";'
  + 'for(var i=0;i<16;i++){h+=b[i].toString(16).padStart(2,"0")}'
  + 'return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)}})();</script>'

/** Marker comment so the injected script is greppable in served HTML. */
const MARKER = '<!--lan-access-polyfill-->'

/** Inject the polyfill as the first child of <head> (runs before everything). */
function injectPolyfill(html) {
  const head = html.indexOf('<head>')
  if (head === -1) return html
  return html.slice(0, head + 6) + MARKER + POLYFILL_SCRIPT + html.slice(head + 6)
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
  ctx.effect(() => ctx.webServer.tapIndex(injectPolyfill), 'lan-access: randomUUID polyfill')
}

export { apply }
