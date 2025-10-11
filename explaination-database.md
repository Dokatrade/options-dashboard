# Options Dashboard Codebase Overview

## Overview
- ETH Options Dashboard is a Vite/React 18 SPA for tracking ETH option spreads and multi-leg positions sourced from Bybit’s public REST/WS APIs, persisting everything locally via Zustand + localStorage (`README.md:1`, `src/App.tsx:1`, `src/store/store.ts:1`, `Options-Dashboard.md:1`).

## Architecture
- UI shell renders a market context card (embeds TradingView widget), portfolio summary, and a consolidated positions table inside a `SlowModeProvider` that throttles expensive refreshes when enabled (`src/App.tsx:1`, `src/components/MarketContextCard.tsx:1`, `src/components/PortfolioSummary.tsx:1`, `src/components/UnifiedPositionsTable.tsx:1`, `src/contexts/SlowModeContext.tsx:1`).
- State layer stores spreads, arbitrary multi-leg positions, portfolio metadata, and settings; actions cover CRUD, settlements, favorites, snapshot imports, and multi-portfolio management (`src/store/store.ts:1`, `src/components/PortfolioManagerModal.tsx:1`).
- Services wrap Bybit REST endpoints for instruments, tickers, order books, HV30, settlement history, and spot klines (with caching/helpers) plus realtime WebSocket subscriptions with auto-resubscribe and L1 book merges (`src/services/bybit.ts:1`, `src/services/ws.ts:1`).
- Utility modules define shared data types, Black–Scholes pricing/implied vol, strategy-name heuristics, symbol normalization, CSV export, and spot-symbol detection used across components (`src/utils/types.ts:1`, `src/utils/bs.ts:1`, `src/utils/strategyDetection.ts:1`).

## Key Features
- Add Spread form focuses on two-leg credit/debit spreads with live mid/exec previews pulled via REST + WS; the advanced Add Position workflow layers filtering, chain browsing, and drafting for arbitrary constructions (including per-portfolio assignment) (`src/components/AddSpread.tsx:1`, `src/components/AddPosition.tsx:1`, `src/components/add-position/*.tsx`).
- Unified table merges saved spreads and custom positions so the same greeks/PnL logic, editing, IF rule builder, settlement capture, and CSV export apply to both; it polls REST for baselines, subscribes to WS for streaming updates, and keeps per-column/feature preferences in localStorage (`src/components/UnifiedPositionsTable.tsx:1`).
- Position view modal models payoff curves with Black–Scholes under different assumptions, overlays HV30, and shows embedded spot charts using `lightweight-charts`; realtime pricing combines option and underlying feeds for accurate greeks/PnL toggles (`src/components/PositionView.tsx:1`, `src/components/SpotPriceChart.tsx:1`).
- Top bar exposes JSON backup/import that also restores UI preferences, leveraging store `importState` validation and heuristics to split legacy unified payloads into spread vs combo records (`src/components/TopBarBackupButtons.tsx:1`, `src/store/store.ts:1`).

## Persistence & Preferences
- Zustand `persist` middleware keeps all portfolios, positions, and settings in localStorage, with migration-friendly normalization on import; numerous UI modules read/write scoped keys for user preferences (column visibility, slow mode, chart settings, etc.) (`src/store/store.ts:1`, `src/contexts/SlowModeContext.tsx:1`, `src/components/PositionView.tsx:1`).
- Settlements map stores expiry-specific underlying prices to support PnL lock-in and expired-leg handling across spreads and positions (`src/store/store.ts:1`).

## Build & Tooling
- Vite 5 with the React plugin handles bundling and dev server; TypeScript runs in strict mode with modern module resolution, and `lightweight-charts` plus the TradingView widget provide market visuals (`package.json:1`, `vite.config.ts:1`, `tsconfig.json:1`, `src/components/SpotPriceChart.tsx:1`, `src/components/MarketContextCard.tsx:1`).
- Comprehensive architectural notes, API specs, and roadmap live in `Options-Dashboard.md`, serving as the definitive reverse-engineering guide for the system (`Options-Dashboard.md:1`).
