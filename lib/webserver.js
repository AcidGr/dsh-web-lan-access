/**
 * lan-access webserver half — a drop-in replacement for
 * `@deepseek-ai/dsh-host-webserver` that accepts a wildcard bind address.
 *
 * Why this exists: from dsh 0.2.1 the shipped webserver rejects `0.0.0.0` and
 * `::` in its config schema, so a bundle patch can no longer reach every
 * interface by writing the bind host into the `webserver` row — the row fails
 * to validate and the whole boot aborts. A patch cannot retarget that row's
 * `name` either (app-boot skips a name mismatch), so the only way to keep
 * all-interface binding is to disable the shipped row and mount this subclass
 * under a new id.
 *
 * Two things differ from the parent:
 *
 * 1. `Config` delegates to the shipped schema and rescues only the wildcard
 *    rejection. Every other rule still applies: a non-literal host, a port out
 *    of range, or a missing port fail exactly as before.
 *
 * 2. `getOrigin()` never returns a wildcard origin. The parent builds the URL
 *    from the bind address, so `0.0.0.0` would yield `http://0.0.0.0:3080` —
 *    an address no browser can dial. A wildcard listener reports loopback
 *    instead, and `--public-url` still overrides the advertised root upstream.
 *
 * Note that binding a wildcard also forfeits the fence's bind-address
 * auto-trust: that check matches the listener's literal, and `0.0.0.0` matches
 * no request Host. The bundle patch therefore derives `trustedHosts` from the
 * live interface list; without it every remote `/api` call returns 403.
 *
 * Only the default export is imported: the address helpers this needs are not
 * exported by every supported release, and the parent's listener lifecycle,
 * routes, and index taps are inherited unchanged.
 */
import WebServer from '@deepseek-ai/dsh-host-webserver'

/** The address a wildcard listener advertises, since it has none of its own. */
const LOOPBACK_HOST = '127.0.0.1'

/** The shipped schema's own wording for the one rejection this module relaxes. */
const WILDCARD_REJECTION = /is an unspecified \(wildcard\) address/

/**
 * Whether an address requests every interface at once.
 *
 * Mirrors the shipped predicate: only an all-zero address is wildcard, so
 * `0.0.0.1` (a real, if unusual, interface address) still binds normally.
 * @param host - configured bind address.
 * @returns true for `0.0.0.0`, `::`, and their expanded or mapped spellings.
 */
function isWildcardBind(host) {
  const text = String(host).trim().toLowerCase()
  if (text === '0.0.0.0' || text === '::') return true
  const bare = text.includes('%') ? text.slice(0, text.indexOf('%')) : text
  if (bare === '0.0.0.0' || bare === '::') return true
  // `::ffff:0.0.0.0` and long-form zero groups still mean "every interface".
  const ipv4Tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare)
  if (ipv4Tail !== null) {
    const octets = ipv4Tail.slice(1).map(Number)
    if (octets.every((part) => part === 0)) return true
  }
  if (/^[0:]+$/.test(bare)) return true
  return false
}

/**
 * Whether a thrown validation error is the wildcard rejection and nothing else.
 * A non-literal host or a malformed TLS pair must keep failing loudly.
 * @param error - whatever the shipped validator threw.
 * @returns true only for the unspecified-address rejection.
 */
function isWildcardRejection(error) {
  return WILDCARD_REJECTION.test(String(error?.message ?? error))
}

/**
 * Build a schema that accepts a wildcard bind address.
 *
 * The rescue re-validates the same value with loopback substituted, so every
 * other field is still checked by the shipped rules, then restores the real
 * host — a bad port or a non-literal address therefore fails exactly as it
 * does without this plugin.
 * @param base - the shipped `WebServer.Config` schema.
 * @returns a `~standard` schema with the same rules minus the wildcard ban.
 */
function relaxWildcardBind(base) {
  return {
    '~standard': {
      validate(value) {
        try {
          return base['~standard'].validate(value)
        } catch (error) {
          if (!isWildcardRejection(error)) throw error
          const result = base['~standard'].validate({
            ...value,
            host: LOOPBACK_HOST,
          })
          if (result.issues) return result
          return { value: { ...result.value, host: value.host } }
        }
      },
    },
  }
}

/**
 * Render a bind address as the host part of a URL.
 * @param host - a configured bind address.
 * @returns the address text, IPv6 bracketed.
 */
function urlHost(host) {
  const text = String(host)
  return text.includes(':') ? `[${text}]` : text
}

/**
 * The Web carrier with a wildcard-capable bind address.
 *
 * The service name, routes, index taps, and listener lifecycle all come from
 * the parent; only config validation and the advertised origin differ.
 */
export default class LanWebServer extends WebServer {
  /** Shipped rules with the unspecified-address rejection lifted. */
  static Config = relaxWildcardBind(WebServer.Config)

  /**
   * The dialable root URL for this listener.
   *
   * A wildcard bind has no address of its own, so it reports loopback; a
   * deployment that wants a different root passes `--public-url`, which
   * `dsh-web-app` prefers over this value.
   * @returns the origin, for example `http://127.0.0.1:3080`.
   * @throws before `listen` binds a port, or for an address no URL expresses.
   */
  getOrigin() {
    const bound = String(this.config.host)
    const zoneAt = bound.indexOf('%')
    const bare = zoneAt === -1 ? bound : bound.slice(0, zoneAt)
    const wildcard = isWildcardBind(bare)
    if (!wildcard && zoneAt !== -1) {
      throw new Error(
        `webserver: bind address ${JSON.stringify(bound)} carries an interface zone id, which no URL can express`,
      )
    }
    if (this.port === undefined) {
      throw new Error('webserver: origin read before the listener bound a port')
    }
    const dialHost = wildcard ? LOOPBACK_HOST : urlHost(bare)
    return `${this.protocol}//${dialHost}:${String(this.port)}`
  }
}

export { LOOPBACK_HOST, isWildcardBind, isWildcardRejection, relaxWildcardBind }
