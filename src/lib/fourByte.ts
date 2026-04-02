// Sourcify signature lookup for unknown function selectors and event topic hashes.
// https://api.4byte.sourcify.dev/signature-database/v1/lookup
//
// Requests are batched per animation frame so a burst of unknown selectors on a
// new block produces a single HTTP request rather than one per row.

const BASE = 'https://api.4byte.sourcify.dev/signature-database/v1/lookup'

// Module-level caches persist for the page lifetime.
const methodCache = new Map<string, string | null>()
const eventCache  = new Map<string, string | null>()

// Pending queues: hex → resolve callbacks waiting for this hash.
const pendingMethods = new Map<string, Array<(r: string | null) => void>>()
const pendingEvents  = new Map<string, Array<(r: string | null) => void>>()

let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = setTimeout(flush, 16)
}

interface SigEntry { name: string; filtered: boolean; hasVerifiedContract: boolean }
interface LookupResponse {
  ok: boolean
  result: {
    function?: Record<string, SigEntry[] | null>
    event?:    Record<string, SigEntry[]>
  }
}

/** Pick the best match: prefer verified-contract entries, then first result.
 *  Returns the full text signature, e.g. "transfer(address,uint256)".
 *  Callers extract the display name with sig.split('(')[0] as needed. */
function bestSig(entries: SigEntry[] | null | undefined): string | null {
  if (!entries || entries.length === 0) return null
  const verified = entries.find((e) => e.hasVerifiedContract)
  return (verified ?? entries[0]).name
}

async function flush() {
  flushTimer = null

  const methods = [...pendingMethods.keys()]
  const events  = [...pendingEvents.keys()]
  if (methods.length === 0 && events.length === 0) return

  // Snapshot and clear queues before the async fetch so new lookups during
  // the request go into fresh queue entries.
  const methodResolvers = new Map(methods.map((h) => [h, pendingMethods.get(h)!]))
  const eventResolvers  = new Map(events.map((h) => [h, pendingEvents.get(h)!]))
  for (const h of methods) pendingMethods.delete(h)
  for (const h of events)  pendingEvents.delete(h)

  const params = new URLSearchParams()
  if (methods.length) params.set('function', methods.join(','))
  if (events.length)  params.set('event',    events.join(','))

  try {
    const res = await fetch(`${BASE}?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as LookupResponse

    for (const [hex, callbacks] of methodResolvers) {
      const result = bestSig(data.result.function?.[hex])
      methodCache.set(hex, result)
      for (const cb of callbacks) cb(result)
    }
    for (const [hex, callbacks] of eventResolvers) {
      const result = bestSig(data.result.event?.[hex])
      eventCache.set(hex, result)
      for (const cb of callbacks) cb(result)
    }
  } catch {
    for (const [hex, callbacks] of methodResolvers) {
      methodCache.set(hex, null)
      for (const cb of callbacks) cb(null)
    }
    for (const [hex, callbacks] of eventResolvers) {
      eventCache.set(hex, null)
      for (const cb of callbacks) cb(null)
    }
  }
}

/** Returns cached result: string if found, null if not found, undefined if not yet fetched. */
export function getCachedSelector(hex: string): string | null | undefined {
  if (!methodCache.has(hex)) return undefined
  return methodCache.get(hex) as string | null
}

/** Returns cached result: string if found, null if not found, undefined if not yet fetched. */
export function getCachedEventTopic(hex: string): string | null | undefined {
  if (!eventCache.has(hex)) return undefined
  return eventCache.get(hex) as string | null
}

/** Look up a 4-byte function selector. Batched with other pending lookups. */
export function lookupSelector(hex: string): Promise<string | null> {
  if (methodCache.has(hex)) return Promise.resolve(methodCache.get(hex) as string | null)
  return new Promise((resolve) => {
    if (!pendingMethods.has(hex)) pendingMethods.set(hex, [])
    pendingMethods.get(hex)!.push(resolve)
    scheduleFlush()
  })
}

/** Look up a 32-byte event topic hash. Batched with other pending lookups. */
export function lookupEventTopic(hex: string): Promise<string | null> {
  if (eventCache.has(hex)) return Promise.resolve(eventCache.get(hex) as string | null)
  return new Promise((resolve) => {
    if (!pendingEvents.has(hex)) pendingEvents.set(hex, [])
    pendingEvents.get(hex)!.push(resolve)
    scheduleFlush()
  })
}
