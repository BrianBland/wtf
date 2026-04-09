import { useEffect, useState } from 'react'

export function useCachedLookup(
  key: string,
  getCached: (key: string) => string | null | undefined,
  lookup: (key: string) => Promise<string | null>,
): string | null {
  const [resolved, setResolved] = useState<string | null>(() => {
    const cached = getCached(key)
    return typeof cached === 'string' ? cached : null
  })

  useEffect(() => {
    const cached = getCached(key)
    if (typeof cached === 'string') {
      setResolved(cached)
      return
    }
    setResolved(null)
    if (cached === null) return

    let cancelled = false
    lookup(key).then((result) => {
      if (!cancelled && result) setResolved(result)
    })

    return () => {
      cancelled = true
    }
  }, [key, getCached, lookup])

  return resolved
}
