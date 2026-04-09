import { useEffect } from 'react'
import { KNOWN_TOKENS } from '../lib/protocols'
import { useStore } from '../store'

function normalizeAddresses(addresses: Iterable<string | null | undefined>): string[] {
  const normalized = new Set<string>()
  for (const address of addresses) {
    if (!address) continue
    normalized.add(address.toLowerCase())
  }
  return [...normalized]
}

export function usePrefetchTokenMetadata(addresses: Iterable<string | null | undefined>) {
  const { tokenCache, fetchToken } = useStore()
  const tokenAddresses = normalizeAddresses(addresses)

  useEffect(() => {
    for (const address of tokenAddresses) {
      if (!KNOWN_TOKENS[address] && !tokenCache.has(address)) fetchToken(address)
    }
  }, [tokenAddresses, tokenCache, fetchToken])
}

export function usePrefetchPoolMetadata(poolAddresses: Iterable<string | null | undefined>) {
  const { poolCache, fetchPool, tokenCache, fetchToken } = useStore()
  const normalizedPools = normalizeAddresses(poolAddresses)

  useEffect(() => {
    for (const address of normalizedPools) {
      if (!poolCache.has(address)) fetchPool(address)
    }
  }, [normalizedPools, poolCache, fetchPool])

  useEffect(() => {
    for (const address of normalizedPools) {
      const meta = poolCache.get(address)
      if (typeof meta !== 'object') continue
      if (meta.token0 && !KNOWN_TOKENS[meta.token0] && !tokenCache.has(meta.token0)) fetchToken(meta.token0)
      if (meta.token1 && !KNOWN_TOKENS[meta.token1] && !tokenCache.has(meta.token1)) fetchToken(meta.token1)
    }
  }, [normalizedPools, poolCache, tokenCache, fetchToken])
}
