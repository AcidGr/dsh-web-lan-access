import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { apply, injectBootstrap } from '../lib/index.js'

function injectedScript(html) {
  const match = html.match(/<!--lan-access-polyfill--><script>([\s\S]*?)<\/script>/)
  assert.ok(match)
  return match[1]
}

test('registers the bootstrap through the index tap', () => {
  let tap
  let label
  apply({
    webServer: { tapIndex(value) { tap = value; return () => {} } },
    effect(factory, value) { factory(); label = value },
  })
  assert.equal(tap, injectBootstrap)
  assert.equal(label, 'lan-access: trusted remote bootstrap')
})

test('declares trusted Host ownership while preserving HTTP fetch', async () => {
  const calls = []
  const context = {
    Uint8Array,
    crypto: { getRandomValues(value) { value.fill(7); return value } },
    fetch(input, init) { calls.push([input, init]); return Promise.resolve('response') },
  }
  vm.runInNewContext(injectedScript(injectBootstrap('<html><head></head></html>')), context)

  assert.equal(context.__DSH_TRANSPORT__.ownsHost, true)
  assert.equal(await context.__DSH_TRANSPORT__.fetch('/api/test', { method: 'POST' }), 'response')
  assert.deepEqual(calls, [['/api/test', { method: 'POST' }]])
  assert.match(context.crypto.randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('does not replace a transport supplied by another shell', () => {
  const existing = { ownsHost: false, fetch() {} }
  const context = {
    Uint8Array,
    crypto: { randomUUID() { return 'native' } },
    __DSH_TRANSPORT__: existing,
  }
  vm.runInNewContext(injectedScript(injectBootstrap('<head></head>')), context)
  assert.equal(context.__DSH_TRANSPORT__, existing)
})

test('leaves documents without a head unchanged', () => {
  assert.equal(injectBootstrap('<html></html>'), '<html></html>')
})
