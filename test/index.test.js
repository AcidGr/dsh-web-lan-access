import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { BOOTSTRAP_SCRIPT, MARKER, apply, injectBootstrap } from '../lib/index.js'
import {
  isWildcardBind,
  isWildcardRejection,
  relaxWildcardBind,
} from '../lib/webserver.js'

function injectedScript(html) {
  const match = html.match(/<!--lan-access-bootstrap--><script>([\s\S]*?)<\/script>/)
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
    fetch(input, init) { calls.push([input, init]); return Promise.resolve('response') },
  }
  vm.runInNewContext(injectedScript(injectBootstrap('<html><head></head></html>')), context)

  assert.equal(context.__DSH_TRANSPORT__.ownsHost, true)
  assert.equal(await context.__DSH_TRANSPORT__.fetch('/api/test', { method: 'POST' }), 'response')
  assert.deepEqual(calls, [['/api/test', { method: 'POST' }]])
})

test('no longer patches crypto.randomUUID', () => {
  assert.doesNotMatch(BOOTSTRAP_SCRIPT, /randomUUID/)
})

test('does not replace a transport supplied by another shell', () => {
  const existing = { ownsHost: false, fetch() {} }
  const context = { __DSH_TRANSPORT__: existing }
  vm.runInNewContext(injectedScript(injectBootstrap('<head></head>')), context)
  assert.equal(context.__DSH_TRANSPORT__, existing)
})

test('leaves documents without a head unchanged', () => {
  assert.equal(injectBootstrap('<html></html>'), '<html></html>')
})

test('injects the marker before any other head content', () => {
  const html = injectBootstrap('<head><script src="boot.js"></script></head>')
  assert.ok(html.indexOf(MARKER) < html.indexOf('boot.js'))
})

test('recognises only all-zero bind addresses as wildcard', () => {
  for (const host of ['0.0.0.0', '::', '::ffff:0.0.0.0', '0:0:0:0:0:0:0:0', '0.0.0.0%eth0']) {
    assert.equal(isWildcardBind(host), true, host)
  }
  for (const host of ['0.0.0.1', '100.78.28.76', '192.168.31.212', '::1', '127.0.0.1', 'example.com']) {
    assert.equal(isWildcardBind(host), false, host)
  }
})

test('relaxes only the wildcard rejection', () => {
  const wildcard = new Error('webserver: host "0.0.0.0" is an unspecified (wildcard) address, which is not supported')
  const literal = new Error('webserver: host "x" is not a concrete IPv4 or IPv6 address literal')
  assert.equal(isWildcardRejection(wildcard), true)
  assert.equal(isWildcardRejection(literal), false)
})

test('relaxed schema accepts wildcard and still enforces the shipped rules', () => {
  const shipped = {
    '~standard': {
      validate(value) {
        if (value.host === '0.0.0.0') {
          throw new Error('webserver: host "0.0.0.0" is an unspecified (wildcard) address, which is not supported')
        }
        if (typeof value.host !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(value.host)) {
          throw new Error(`webserver: host ${JSON.stringify(value.host)} is not a concrete IPv4 or IPv6 address literal`)
        }
        if (!Number.isInteger(value.port) || value.port > 65535) {
          return { issues: [{ message: 'port out of range' }] }
        }
        return { value }
      },
    },
  }
  const schema = relaxWildcardBind(shipped)

  assert.deepEqual(schema['~standard'].validate({ host: '0.0.0.0', port: 3080 }), {
    value: { host: '0.0.0.0', port: 3080 },
  })
  assert.deepEqual(schema['~standard'].validate({ host: '10.0.0.2', port: 3080 }), {
    value: { host: '10.0.0.2', port: 3080 },
  })
  assert.throws(
    () => schema['~standard'].validate({ host: 'example.com', port: 3080 }),
    /is not a concrete IPv4 or IPv6 address literal/,
  )
  assert.ok(schema['~standard'].validate({ host: '0.0.0.0', port: 99999 }).issues)
})
