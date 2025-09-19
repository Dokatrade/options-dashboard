# Silent Refresh Mode

## Purpose
Provide a low-frequency refresh option that drops CPU load and device temperature while working in the dashboard. When enabled, the entire home screen (Market, Portfolio, Add Position, My Positions) switches to batched 15‑minute updates managed by a shared controller, while modal/detail views keep real-time data.

## User Experience
- A single toggle `Slow refresh (15 min)` sits in the `My Positions` header next to `PNL($) exec`.
- When on, the main cards display the most recent refresh timestamp, the next scheduled update, and a `Refresh now` button (disabled during an in-flight batch).
- Preference persists in `localStorage`, so the choice survives reloads.
- Manual refresh triggers the same batching logic immediately and restarts the 15‑minute timer.

## Behaviour Overview
### Real-time Mode (default)
- Websocket subscriptions (spot/options) stay active across Market, Add Position, and Positions table.
- REST fallbacks poll frequently (8–30s) for stubborn symbols and cache warm-up.
- Each incoming tick updates affected components instantly.

### Slow Mode
- Central `SlowModeProvider` keeps the toggle state, timer, and subscriber list.
- On entry:
  1. Complete a full refresh so the UI starts from fresh data.
  2. Unsubscribe live feeds in all cards and cancel interval polls.
  3. Schedule a single timer to rerun every 15 minutes (configurable via `SLOW_REFRESH_MS`).
- Subscribers (`MarketContextCard`, `AddPosition`, `UnifiedPositionsTable`) register callbacks that:
  - Fetch bulk snapshots (tickers/orderbooks) and update state in controlled chunks to avoid CPU spikes.
  - Limit concurrency (25-symbol batches) and yield (`setTimeout(..., 0)`) between batches.
- Manual refresh from any card calls `manualRefresh`, which cancels the timer, runs subscribers immediately, then reschedules the timer if slow mode is still on.
- Leaving slow mode cancels timers, clears “next update”, resubscribes to websockets, and immediately triggers a real-time sync so data catches up.

## Edge Cases & Guarantees
- First page load always performs an immediate real-time fetch before respecting saved slow-mode preference.
- When toggling ON mid-refresh, the provider waits for the current batch to finish before cancelling live feeds to avoid partial updates.
- Toggling OFF reinstates realtime subscriptions instantly and kicks off a fresh sync.
- Modals (`View`, `Edit`, `IF`) and background calculations (IF rules, PositionView) continue to run at full speed, independent of the toggle.

## Implementation Notes
- `slowMode`, stats (`lastUpdated`, `nextUpdate`, `refreshing`), and subscriber management live in `SlowModeContext`.
- Each main card has a `performSlowRefresh` function that reuses existing REST helpers but throttles throughput and updates component state in batches.
- Legacy `positions-ui-v1` prefs now merge rather than overwrite, so slow-mode state remains consistent across cards.
- Realtime-only logic in components guards on `!slowMode` to keep websockets/intervals active when appropriate.

## Validation Checklist
- Toggle on/off repeatedly: ensure timers are cleared, subscriptions restored, and no duplicate callbacks accumulate.
- Confirm manual refresh updates all cards and reschedules correctly.
- Verify persisted slow mode reloads with fresh data before switching to 15‑minute cadence.
- Profile CPU usage to ensure noticeable reduction when the toggle is active.
