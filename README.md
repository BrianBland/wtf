# WTF — Watch Token Flows

A real-time Ethereum block explorer and DeFi transaction analyzer. Connect to any EVM-compatible RPC endpoint and inspect what's actually happening on-chain, block by block.

## What it does

**Block range view** — Live feed of incoming blocks with a sparkline (gas or tx count), summary stats, sender/recipient/method histograms, a value flow Sankey, and per-protocol drill-down.

**Block view** — Deep-dive into any block:
- **Tx aggregations** — senders, recipients, method selectors, protocol breakdown
- **Call aggregations** — every contract call (including nested internal calls) across all txs, aggregated by contract + method, sortable by call count, gas, or tx count
- **State access** — which storage slots were read/written by which transactions; conflict detection, parallelization analysis
- **Value flow** — Sankey diagram of token/ETH flows through pools and protocols
- **Protocol activity** — per-protocol event drill-down (Uniswap V3, Aerodrome, Aave, Compound/Moonwell)
- **Cross-tx account patterns** — accounts that appear in multiple transactions (round-trips, borrow/repay, LP add/remove, multi-swap)

**Tx view** — Full transaction detail: value flows, logs, call trace, state diff.

## Tech stack

- React + TypeScript (Vite)
- Zustand for state management
- Direct JSON-RPC over WebSocket (no ethers/viem dependency)
- `debug_traceTransaction` with `prestateTracer` + `callTracer` for deep block analysis

## Running locally

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`, enter a WebSocket RPC URL (e.g. `wss://base.drpc.org`), and connect.

State access tracing requires a node with `debug_traceTransaction` support (e.g. a full node or a debug-enabled RPC provider).

## Testing

Offline regression tests run via `node:test` and `tsx`, with no network access or Foundry required.

```bash
npm test
```

## Uniswap V4 support and tests

On Base (chain 8453), V4 swap currencies resolve from canonical, full-PoolId-verified
PoolManager `Initialize` logs in loaded blocks, or the PositionManager's
`poolKeys(bytes25)` mapping at the requested block. Lookups are connection-scoped,
limited to four concurrent calls, and retry unresolved results later. Other chains
are not resolved through Base deployments. No historical log scans or indexer are used.

Custom pools absent from the PositionManager mapping remain **currencies unresolved**
unless their Initialize log is loaded; historical RPC state may also be unavailable.
Amounts are **pool-level Swap event deltas**, not hook-adjusted final user settlement.
Native ETH remains distinct from WETH. Singleton netting means per-pool settlement
flows/volumes and a settlement Sankey are not provided; no transfer edges are guessed.

Run `npm test` for offline fixtures and malformed-ABI, chain/client/block isolation,
concurrency and address-guard regressions; run `npm run build` for the production build.
The Base repeated-swap fixture references transaction
`0x75728f7a6090800f85faf0aafee2e342e9f0fc84ff42025fc48032d3741e6e8f`
in block **51480862**. Tests require no RPC credentials.
