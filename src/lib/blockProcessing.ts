import {
  Block, Transaction, UserOp, Log, RawBlock, RawLog, RawReceipt,
} from '../types'
import { PoolMeta } from './poolFetch'
import { USER_OPERATION_EVENT_TOPIC } from './protocols'
import {
  hexToBigInt, hexToNumber, getSelector,
  topicToAddress, decodeUint256,
} from './formatters'
import { decodeCalldata, DecodedValue } from './calldataDecoder'
import { RpcClient } from './rpc'
import { detectProtocolHint, fetchV3PoolProtocols, processLogs } from './logProcessing'
import { V4PoolKey, resolveV4PoolKeys } from './v4PoolKey'
import { detectDeployments } from './deployments'

const HANDLEOPS_SELECTORS = new Set(['0x1fad948c', '0x765e827f'])

function extractUserOps(
  logs: Log[],
  input: string,
  selector: string,
  poolProtocols: Map<string, string>,
  v4PoolKeys: Map<string, V4PoolKey>,
  poolMetas: Map<string, PoolMeta>,
): UserOp[] | undefined {
  if (!HANDLEOPS_SELECTORS.has(selector)) return undefined

  const uoeIndices: number[] = []
  for (let i = 0; i < logs.length; i++) {
    if (logs[i].topics[0] === USER_OPERATION_EVENT_TOPIC) uoeIndices.push(i)
  }
  if (uoeIndices.length === 0) return undefined

  const logSlices: Log[][] = []
  let prev = 0
  for (const idx of uoeIndices) {
    logSlices.push(logs.slice(prev, idx))
    prev = idx + 1
  }

  const decoded = decodeCalldata(input, selector)
  const opsValue = decoded?.params[0]?.value
  const opElements: DecodedValue[] = opsValue?.kind === 'array' ? opsValue.elements : []

  return uoeIndices.map((uoeIdx, i) => {
    const uoeLog = logs[uoeIdx]
    const sender = uoeLog.topics[2] ? topicToAddress(uoeLog.topics[2]) : '0x'
    const nonce = decodeUint256(uoeLog.data, 0)
    const success = decodeUint256(uoeLog.data, 1) !== 0n
    const actualGasUsed = decodeUint256(uoeLog.data, 3)

    let callData = ''
    const opElem = opElements[i]
    if (opElem?.kind === 'tuple') {
      const cdField = opElem.fields.find((f) => f.name === 'callData')
      if (cdField?.value.kind === 'bytes') callData = cdField.value.hex
    }

    const logSlice = logSlices[i] ?? []
    const { tokenFlows, protocols } = processLogs(logSlice, null, poolProtocols, v4PoolKeys, poolMetas)

    return { index: i, sender, nonce, callData, success, actualGasUsed, tokenFlows, protocols, logs: logSlice }
  })
}

function rawLogToLog(raw: RawLog): Log {
  return {
    address:         raw.address.toLowerCase(),
    topics:          raw.topics.map((t) => t.toLowerCase()),
    data:            raw.data,
    transactionHash: raw.transactionHash.toLowerCase(),
    logIndex:        hexToNumber(raw.logIndex),
  }
}

export function processBlock(
  raw: RawBlock,
  rawLogs: RawLog[],
  rawReceipts: RawReceipt[] | null,
  poolProtocols: Map<string, string> = new Map(),
  v4PoolKeys: Map<string, V4PoolKey> = new Map(),
  poolMetas: Map<string, PoolMeta> = new Map(),
): Block {
  const logsByTx = new Map<string, Log[]>()
  for (const rl of rawLogs) {
    if (rl.removed) continue
    const hash = rl.transactionHash.toLowerCase()
    if (!logsByTx.has(hash)) logsByTx.set(hash, [])
    logsByTx.get(hash)!.push(rawLogToLog(rl))
  }

  const gasUsedByTx = new Map<string, bigint>()
  const receiptByTx = new Map<string, RawReceipt>()
  const revertedTxSet = new Set<string>()
  if (Array.isArray(rawReceipts)) {
    for (const r of rawReceipts) {
      if (!r || typeof r !== 'object' || typeof r.transactionHash !== 'string') continue
      const txHash = r.transactionHash.toLowerCase()
      receiptByTx.set(txHash, r)
      if (typeof r.gasUsed === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(r.gasUsed)) {
        gasUsedByTx.set(txHash, hexToBigInt(r.gasUsed))
      }
      if (r.status === '0x0') revertedTxSet.add(txHash)
    }
  }

  const transactions: Transaction[] = raw.transactions.map((rawTx) => {
    const hash = rawTx.hash.toLowerCase()
    const logs = logsByTx.get(hash) ?? []
    const hint = detectProtocolHint(rawTx.to)
    const { tokenFlows, protocols } = processLogs(logs, hint, poolProtocols, v4PoolKeys, poolMetas)
    const value = hexToBigInt(rawTx.value)
    const gasUsed = gasUsedByTx.get(hash)
    const maxPriorityFeePerGas = rawTx.maxPriorityFeePerGas
      ? hexToBigInt(rawTx.maxPriorityFeePerGas)
      : undefined
    const gasPrice = rawTx.gasPrice && !rawTx.maxPriorityFeePerGas
      ? hexToBigInt(rawTx.gasPrice)
      : undefined

    const methodSelector = getSelector(rawTx.input)
    return {
      hash,
      blockNumber:    hexToNumber(rawTx.blockNumber),
      index:          hexToNumber(rawTx.transactionIndex),
      from:           rawTx.from.toLowerCase(),
      to:             rawTx.to?.toLowerCase() ?? null,
      value,
      gas:            hexToBigInt(rawTx.gas),
      gasUsed,
      gasPrice,
      maxPriorityFeePerGas,
      input:          rawTx.input,
      methodSelector,
      logs,
      tokenFlows,
      ethFlows: value > 0n
        ? [{ from: rawTx.from.toLowerCase(), to: rawTx.to?.toLowerCase() ?? '0x', value, type: 'tx' as const }]
        : [],
      protocols,
      deployments: detectDeployments(logs, rawTx, receiptByTx.get(hash)),
      reverted: revertedTxSet.has(hash) || undefined,
      userOps: methodSelector
        ? extractUserOps(logs, rawTx.input, methodSelector, poolProtocols, v4PoolKeys, poolMetas)
        : undefined,
    }
  })

  return {
    number:       hexToNumber(raw.number),
    hash:         raw.hash.toLowerCase(),
    parentHash:   raw.parentHash.toLowerCase(),
    timestamp:    hexToNumber(raw.timestamp),
    gasUsed:      hexToBigInt(raw.gasUsed),
    gasLimit:     hexToBigInt(raw.gasLimit),
    baseFeePerGas: raw.baseFeePerGas ? hexToBigInt(raw.baseFeePerGas) : 0n,
    miner:        raw.miner.toLowerCase(),
    transactions,
  }
}

export interface LoadedBlockData {
  block: Block
  newMeta: Map<string, PoolMeta>
  newV4PoolKeys: Map<string, V4PoolKey>
}

export async function loadBlockData(
  client: RpcClient,
  blockNumber: number,
  poolCache: Map<string, PoolMeta | 'loading' | 'error'>,
  v4PoolKeyCache: Map<string, V4PoolKey> = new Map(),
): Promise<LoadedBlockData | null> {
  const hexN = `0x${blockNumber.toString(16)}`
  const [raw, rawLogs, rawReceipts] = await Promise.all([
    client.call<RawBlock>('eth_getBlockByNumber', [hexN, true]),
    client.call<RawLog[]>('eth_getLogs', [{ fromBlock: hexN, toBlock: hexN }]),
    client.call<RawReceipt[]>('eth_getBlockReceipts', [hexN]).catch(() => null),
  ])
  if (!raw) return null

  const logs = rawLogs ?? []
  const [{ protocols: poolProtocols, newMeta }, newV4PoolKeys] = await Promise.all([
    fetchV3PoolProtocols(client, logs, poolCache, hexN),
    // Pin the PositionManager poolKeys() fallback to this block when practical.
    resolveV4PoolKeys(client, logs, v4PoolKeyCache, hexN),
  ])
  // Merge newly-resolved keys so swaps in *this* block can use them immediately —
  // the caller's cache won't include them until it processes the returned newV4PoolKeys.
  const mergedV4PoolKeys = newV4PoolKeys.size > 0
    ? new Map([...v4PoolKeyCache, ...newV4PoolKeys])
    : v4PoolKeyCache
  // PoolMeta is passed through from the existing fetch/cache path; this layer performs no RPCs.
  // Its integrity therefore depends on that path rejecting malformed call responses. If no valid
  // metadata reaches processLogs, token identity is omitted and volume remains explicitly incomplete.
  const cachedMeta = [...poolCache].filter((entry): entry is [string, PoolMeta] => typeof entry[1] === 'object')
  const mergedPoolMetas = new Map<string, PoolMeta>([...cachedMeta, ...newMeta])
  return {
    block: processBlock(raw, logs, rawReceipts, poolProtocols, mergedV4PoolKeys, mergedPoolMetas),
    newMeta,
    newV4PoolKeys,
  }
}
