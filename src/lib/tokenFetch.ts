import { RpcClient } from './rpc'

export interface TokenDetails {
  symbol:   string
  name:     string
  decimals: number
  isNFT:    boolean
}

const SYMBOL_SEL   = '0x95d89b41'
const NAME_SEL     = '0x06fdde03'
const DECIMALS_SEL = '0x313ce567'

/**
 * Decode an ABI-encoded string return value.
 * Handles both the standard dynamic encoding (offset + length + bytes)
 * and the bytes32 encoding used by some old tokens (e.g. MKR, SAI).
 */
function decodeAbiString(hex: string): string {
  if (!hex || hex === '0x' || hex.length < 4) return ''
  const data = hex.startsWith('0x') ? hex.slice(2) : hex

  try {
    if (data.length >= 128) {
      // Standard ABI string: [offset (32 bytes)][length (32 bytes)][data]
      const offset = parseInt(data.slice(0, 64), 16) * 2
      const length = parseInt(data.slice(offset, offset + 64), 16)
      if (length > 0 && length < 256) {
        const strHex = data.slice(offset + 64, offset + 64 + length * 2)
        const bytes = new Uint8Array(strHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
        return new TextDecoder().decode(bytes).replace(/\x00/g, '')
      }
    }

    // bytes32 fallback: read until null byte
    const bytes: number[] = []
    for (let i = 0; i < Math.min(64, data.length); i += 2) {
      const b = parseInt(data.slice(i, i + 2), 16)
      if (b === 0) break
      bytes.push(b)
    }
    if (bytes.length > 0) return new TextDecoder().decode(new Uint8Array(bytes))
  } catch { /* ignore */ }

  return ''
}

/** Returns null if the call returned empty (no decimals — likely ERC-721). */
function decodeUint8OrNull(hex: string): number | null {
  if (!hex || hex === '0x') return null
  const data = hex.startsWith('0x') ? hex.slice(2) : hex
  const n = parseInt(data.replace(/^0+/, '') || '0', 16)
  return isNaN(n) || n > 255 ? null : n
}

export async function fetchTokenDetails(
  client: RpcClient,
  address: string,
): Promise<TokenDetails> {
  const call = (data: string) =>
    client.call<string>('eth_call', [{ to: address, data }, 'latest']).catch(() => '0x')

  const [symbolHex, nameHex, decimalsHex] = await Promise.all([
    call(SYMBOL_SEL),
    call(NAME_SEL),
    call(DECIMALS_SEL),
  ])

  const symbol   = decodeAbiString(symbolHex)
  const name     = decodeAbiString(nameHex)
  const decimals = decodeUint8OrNull(decimalsHex)
  const isNFT    = decimals === null

  return {
    symbol:   symbol || address.slice(2, 7).toUpperCase(),
    name:     name   || 'Unknown Token',
    decimals: decimals ?? 0,
    isNFT,
  }
}
