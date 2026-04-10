import { useState } from 'react'
import { hexColors, keyToHsl, contrastColor } from '../lib/colorize'
import { KNOWN_TOKENS, KNOWN_PROTOCOLS, KNOWN_SELECTORS, KNOWN_TOPICS } from '../lib/protocols'
import { shortAddr } from '../lib/formatters'
import { useStore } from '../store'
import { getCachedSelector, getCachedEventTopic, lookupSelector, lookupEventTopic } from '../lib/fourByte'
import { hasKnownFunctionAbi, selectorMatchesKnownAbi, sigMatchesCalldata } from '../lib/calldataDecoder'
import { useCachedLookup } from '../hooks/useCachedLookup'
import { usePrefetchTokenMetadata } from '../hooks/usePrefetchMetadata'

interface HexTagProps {
  value: string
  type?: 'address' | 'selector' | 'hash' | 'raw'
  length?: number   // chars to show (for address shortening)
  muted?: boolean   // override: use neutral color
  copyable?: boolean
  className?: string
  title?: string
  label?: string    // override the displayed text
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
  value, type = 'address', muted = false, copyable = true, className = '', title, label: labelProp,
}: HexTagProps) {
  const [copied, setCopied] = useState(false)
  const label = labelProp ?? getLabel(value, type)
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

/** Show a method selector. Looks up unknown selectors on 4byte.directory. */
export function SelectorTag({ selector, inputHex }: { selector: string | null; inputHex?: string }) {
  if (!selector) return <span className="muted">—</span>
  const known = KNOWN_SELECTORS[selector]
  if (known) {
    const isCompatible = !inputHex || !hasKnownFunctionAbi(selector) || selectorMatchesKnownAbi(selector, inputHex)
    if (!isCompatible) {
      return <HexTag value={selector} type="raw" title={selector} label={selector} />
    }
    return <HexTag value={selector} type="selector" title={`${selector} → ${known}`} />
  }
  return <DynamicSelectorTag selector={selector} inputHex={inputHex} />
}

function DynamicSelectorTag({ selector, inputHex }: { selector: string; inputHex?: string }) {
  const resolved = useCachedLookup(selector, getCachedSelector, lookupSelector)

  // Validate the resolved signature against actual calldata to reject selector collisions.
  const validSig = resolved && inputHex ? (sigMatchesCalldata(resolved, inputHex) ? resolved : null) : resolved
  const name = validSig?.split('(')[0]
  return (
    <HexTag
      value={selector}
      type="selector"
      label={name}
      title={validSig ? `${selector} → ${validSig}` : selector}
    />
  )
}

/** Show an event topic hash (topic[0]). Looks up unknown topics on 4byte.directory. */
export function TopicTag({ topic }: { topic: string }) {
  const known = KNOWN_TOPICS[topic]
  if (known) {
    return <span className="badge muted" title={topic}>{known}</span>
  }
  return <DynamicTopicTag topic={topic} />
}

function DynamicTopicTag({ topic }: { topic: string }) {
  const resolved = useCachedLookup(topic, getCachedEventTopic, lookupEventTopic)

  const name = resolved?.split('(')[0]
  if (name) {
    return <span className="badge muted" title={resolved ?? topic}>{name}</span>
  }
  return (
    <span className="muted" style={{ fontSize: 9, fontFamily: 'var(--font-mono)' }}>
      {topic.slice(0, 10)}…
    </span>
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
  const { getToken } = useStore()
  usePrefetchTokenMetadata([address])

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
