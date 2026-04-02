// Raw JSON-RPC types (as returned from node)
export interface RawBlock {
  number: string
  hash: string
  parentHash: string
  timestamp: string
  gasUsed: string
  gasLimit: string
  baseFeePerGas?: string
  miner: string
  transactions: RawTransaction[]
}

export interface RawTransaction {
  hash: string
  blockNumber: string
  transactionIndex: string
  from: string
  to: string | null
  value: string
  input: string
  gas: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
  type?: string
}

export interface RawReceipt {
  transactionHash: string
  gasUsed: string
  status?: string
}

export interface RawLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  blockHash: string
  transactionHash: string
  transactionIndex: string
  logIndex: string
  removed?: boolean
}

// Processed, enriched types used in the UI
export interface Block {
  number: number
  hash: string
  parentHash: string
  timestamp: number
  gasUsed: bigint
  gasLimit: bigint
  baseFeePerGas: bigint
  miner: string
  transactions: Transaction[]
}

export interface Transaction {
  hash: string
  blockNumber: number
  index: number
  from: string
  to: string | null
  value: bigint
  gas: bigint                    // gas limit from the transaction (upper bound)
  gasUsed?: bigint               // actual gas used (from eth_getBlockReceipts, if available)
  gasPrice?: bigint              // legacy / type-1 gas price (absent for EIP-1559 type-2 txs)
  maxPriorityFeePerGas?: bigint  // EIP-1559 priority tip cap per gas (type-2 txs only)
  input: string
  methodSelector: string | null  // first 4 bytes of input
  logs: Log[]
  tokenFlows: TokenFlow[]
  ethFlows: EthFlow[]
  protocols: ProtocolEvent[]
}

export interface Log {
  address: string
  topics: string[]
  data: string
  transactionHash: string
  logIndex: number
}

export interface TokenFlow {
  token: string      // contract address
  from: string
  to: string
  amount: bigint
}

export interface EthFlow {
  from: string
  to: string
  value: bigint
  type: 'tx' | 'internal'
}

export interface ProtocolEvent {
  protocol: string
  action: string
  token?: string
  token2?: string
  amount?: bigint
  amount2?: bigint
  user?: string
  extra?: Record<string, unknown>
}

// Call trace from debug_traceTransaction with callTracer
export interface CallTrace {
  type: string
  from: string
  to?: string
  value?: string
  gas?: string
  gasUsed?: string
  input?: string
  output?: string
  error?: string
  revertReason?: string
  calls?: CallTrace[]
}

// UI navigation
export type ViewType = 'config' | 'range' | 'block' | 'tx'

export interface NavState {
  view: ViewType
  blockNumber?: number
  txHash?: string
}
