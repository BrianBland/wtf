export type B20AddressType = 'asset' | 'stablecoin'

export interface B20AddressBadgeMetadata {
  type: B20AddressType
  typeLabel: 'B20 Asset' | 'B20 Stablecoin'
  label: string
  address: string
  title: string
  backgroundColor: string
  color: string
  borderColor: string
}

const B20_PREFIX = 'b2' + '00'.repeat(9)

const B20_TYPE_STYLES: Record<B20AddressType, Pick<B20AddressBadgeMetadata, 'typeLabel' | 'backgroundColor' | 'color' | 'borderColor'>> = {
  asset: {
    typeLabel: 'B20 Asset',
    backgroundColor: '#1d4ed8',
    color: '#ffffff',
    borderColor: '#60a5fa',
  },
  stablecoin: {
    typeLabel: 'B20 Stablecoin',
    backgroundColor: '#047857',
    color: '#ffffff',
    borderColor: '#34d399',
  },
}

/**
 * Classify an exact 20-byte hex address in the B20 namespace.
 *
 * Bytes 0..9 must be 0xb2 followed by nine zero bytes. Byte 10 is the
 * variant: 0x00 for an Asset and 0x01 for a Stablecoin. No prefix matching or
 * coercion is performed, so hashes, factory-like addresses, and malformed
 * values cannot be mistaken for B20 addresses.
 */
export function classifyB20Address(value: string): B20AddressType | null {
  if (!/^0x[0-9a-f]{40}$/i.test(value)) return null

  const hex = value.slice(2).toLowerCase()
  if (!hex.startsWith(B20_PREFIX)) return null

  const variant = hex.slice(20, 22)
  if (variant === '00') return 'asset'
  if (variant === '01') return 'stablecoin'
  return null
}

/** Return all presentation metadata for a B20 address, or null for non-B20 input. */
export function getB20AddressBadgeMetadata(value: string): B20AddressBadgeMetadata | null {
  const type = classifyB20Address(value)
  if (!type) return null

  const address = value.toLowerCase()
  const style = B20_TYPE_STYLES[type]
  return {
    type,
    ...style,
    label: `…${address.slice(-4)}`,
    address,
    title: `${style.typeLabel} · ${address}`,
  }
}

/** Preserve mandatory B20 identity/address text while honoring an explicit title. */
export function b20Title(metadata: B20AddressBadgeMetadata, explicitTitle?: string): string {
  return explicitTitle ? `${explicitTitle} · ${metadata.title}` : metadata.title
}
