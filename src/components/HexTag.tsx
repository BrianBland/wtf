import { useEffect, useState } from 'react'
import { hexColors, keyToHsl, contrastColor } from '../lib/colorize'
import { KNOWN_TOKENS, KNOWN_PROTOCOLS, KNOWN_SELECTORS } from '../lib/protocols'
import { shortAddr } from '../lib/formatters'
import { useStore } from '../store'

interface HexTagProps {
  value: string
  type?: 'address' | 'selector' | 'hash' | 'raw'
  length?: number   // chars to show (for address shortening)
  muted?: boolean   // override: use neutral color
  copyable?: boolean
  className?: string
  title?: string
}

function getLabel(value: string, type: HexTagProps['type']): string {
  if (type === 'address') {
    const token = KNOWN_TOKENS[value]
    if (token) return token.symbol
    const proto = KNOWN_PROTOCOLS[value]
    if (proto) return proto.name
    return shortAddr(value)
  }
  if (type === 'selector') {
    return KNOWN_SELECTORS[value] ?? value
  }
  return value
}

export function HexTag({
  value, type = 'address', muted = false, copyable = true, className = '', title,
}: HexTagProps) {
  const [copied, setCopied] = useState(false)
  const label = getLabel(value, type)
  const { bg, text } = muted ? { bg: 'var(--surface3)', text: 'var(--text2)' } : hexColors(value)

  const handleClick = (e: React.MouseEvent) => {
    if (!copyable) return
    e.stopPropagation()
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <span
      className={`hex-tag ${muted ? 'muted' : ''} ${className}`}
      style={{ backgroundColor: bg, color: text }}
      title={title ?? value}
      onClick={handleClick}
    >
      {copied ? '✓ copied' : label}
    </span>
  )
}

/** Show a method selector, falling back to first N chars if unknown */
export function SelectorTag({ selector }: { selector: string | null }) {
  if (!selector) return <span className="muted">—</span>
  const known = KNOWN_SELECTORS[selector]
  return (
    <HexTag
      value={selector}
      type="selector"
      title={`${selector}${known ? ` → ${known}` : ''}`}
    />
  )
}

/**
 * Token badge: shows a colored symbol pill for known tokens.
 * For unknown tokens, shows the address and triggers an on-demand fetch —
 * once the metadata loads the symbol replaces the address automatically.
 */
export function TokenBadge({ address }: { address: string }) {
  const addr = address.toLowerCase()

  // 1. Static known tokens (hardcoded)
  const staticToken = KNOWN_TOKENS[addr]
  if (staticToken) {
    return (
      <span
        className="badge"
        style={{ background: `${staticToken.color}22`, color: staticToken.color, border: `1px solid ${staticToken.color}44` }}
        title={addr}
      >
        {staticToken.symbol}
      </span>
    )
  }

  return <DynamicTokenBadge address={addr} />
}

function DynamicTokenBadge({ address }: { address: string }) {
  const { fetchToken, getToken, tokenCache } = useStore()
  const cached = tokenCache.get(address)

  // Trigger fetch on first render if not already in cache
  useEffect(() => {
    if (!cached) fetchToken(address)
  }, [address])

  const details = getToken(address)

  if (details) {
    // Derive a color from the address bytes, same as HexTag
    const bg   = keyToHsl(address)
    const text = contrastColor(bg)
    return (
      <span
        className="hex-tag"
        style={{ backgroundColor: bg, color: text }}
        title={`${details.name} · ${address} · ${details.decimals} decimals`}
        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(address) }}
      >
        {details.symbol}
      </span>
    )
  }

  // While loading or on error: show address tag as usual
  return <HexTag value={address} type="address" />
}
