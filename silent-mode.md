# Silent Refresh Mode

## Purpose
Give users a low-frequency update option that reduces CPU usage and temperature when working locally. With the toggle enabled, all cards on the home screen (`Market`, `Portfolio`, `Add Position`, `My Positions`) refresh in coordinated 5‑minute batches via a shared controller, while modal/detail views (e.g. `View`, `Edit`, `IF`) stay real-time.

## UX Details
- Toggle `Slow refresh (5 min)` lives in the `My Positions` toolbar next to `PNL($) exec` and persists in `localStorage`.
- When active, cards show the last refresh time, the next scheduled update, and a `Refresh now` button (disabled when a batch is running).
- Manual refresh triggers an immediate batched update and then restarts the 5‑minute timer.

## Behaviour
### Real-time Mode (default)
- Websocket subscriptions (spot/options) remain active across every card.
- REST fallbacks continue their frequent polling (8–30s) to backfill missing/old data.
- Incoming ticks update the UI instantly.

### Slow Mode (5‑minute cadence)
1. Enabling the toggle triggers one real-time refresh to start with up-to-date data.
2. The controller cancels live subscriptions/intervals on all cards and starts a single timer.
3. Each 5‑minute `Slow refresh` cycle:
   - Fetches REST snapshots (tickers, order books, spot) for all visible symbols.
   - After applying the REST data, performs a short-lived websocket “burst” for key symbols (active option legs + `ETHUSDT`) to capture the latest quotes (fixes PnL/Net Mid drift).
   - Notifies subscribers (`MarketContextCard`, `AddPosition`, `UnifiedPositionsTable`) to update their state in small batches (25 symbols with `setTimeout(...,0)` yields).
4. Manual `Refresh now` cancels the timer, runs the same routine immediately, then re-arms the timer if slow mode is still on.
5. Disabling the toggle clears timers, restarts realtime subscriptions/polls, and immediately syncs data back to the live cadence.

## Scope & Guarantees
- Applies only to the home screen cards. Modals and detailed views keep realtime behaviour so analytical tools remain accurate.
- First page load always runs a realtime fetch before adopting the saved slow-mode preference.
- The controller waits for in-flight refreshes to finish before toggling modes to avoid partial updates.
- Portfolio summary uses store data, so it naturally reflects the same refresh cadence as positions.

## Implementation Notes
- `SlowModeProvider` holds state, timer, subscriber set, and exposes `manualRefresh`/`register` hooks.
- Cards register a `performSlowRefresh` callback that fetches REST data, then calls `captureRealtimeSnapshot` to zip in a brief websocket update for all relevant symbols.
- Settings persistence merges into existing `positions-ui-v1` JSON instead of overwriting it.
- Realtime-only logic (e.g. live websockets) is guarded by `if (!slowMode)` checks.

## Validation Checklist
- Toggle on/off repeatedly: confirm timers and subscriptions are cleaned up with no leaks.
- `Refresh now` updates every card and reschedules correctly.
- Compare PnL/Net Mid between main table and `View` modal under slow mode—values should match after the realtime burst.
- Reload with slow mode enabled: initial fetch should provide fresh data before the 5‑minute cadence begins.
- Profile CPU before/after enabling slow mode to ensure the intended performance benefit.
