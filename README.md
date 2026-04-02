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
