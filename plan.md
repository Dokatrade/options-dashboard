# Build Plan — ETH Options Position Dashboard (MVP+)

This plan reflects the current implementation (verticals + multi-leg) and proposes concrete next steps. **Все интеграции Bybit выполняем по USDT-settled ETH опционам (REST/WS)**. It’s structured by milestones with acceptance and file layout.

---

## Change Log — 2025-09-13

- Переведены все REST/WS вызовы Bybit на USDT-settled опционы (`settleCoin=USDT`, `quoteCoin=USDT`), фильтруем символы `…-USDT` для расчёта greeks/прайсов.
- Введён нормализатор `ensureUsdtSymbol` и миграция Zustand `version=2`, чтобы автоматически обновить сохранённые спрэды/позиции со старых `…-USDC` символов.
- UI-потоки (Add Position, драфты, автодобавление страйков) гарантируют оформление символов с суффиксом `-USDT`.

---

## Change Log — 2025-09-11

Implemented extensive UX and logic improvements across tables and the View modal:

- Data correctness & greeks
  - Accurate per-leg entry storage for verticals (entryShort/entryLong) and multi-leg; net entry preserved.
  - Correct sign handling for per-leg Δ/Θ/Vega and totals (long +, short −); removed Γ from all tables.
  - IV population stabilized: WS merges don’t overwrite with `undefined`; REST fallback backfills missing `markIv/greeks/OI`.

- Unified Positions table
  - Strategy detector for 1–4 leg constructs (verticals credit/debit bull/bear; calendars/diagonals; straddle/strangle; iron butterfly/condor; same-type condor; box; double calendar/diagonal). Fallbacks for others.
  - Favorites: star toggle in Actions, Favorites tab, subtle left indicator (no row tint). Sorting by Date, PnL, Theta, Expiry with asc/desc; preferences persisted.
  - Expanded leg cards: added Vega, fixed Θ sign, bold column headers, compact spacing, wider Symbol with wrapping; extra spacing around Bid/Ask↔Mid and Entry@↔IV%.

- View modal (now for any construction)
  - Payoff at expiry (blue) and T+0 (orange, BS sum across legs) with controls: Show T-curve, IV shift, rate r, Time slider.
  - Strike/spot markers, BE points, shaded bands between strikes, width for symmetric cases; hover tooltip.
  - Export chart as SVG/PNG.
  - Zoom: mouse-wheel (X), Shift+wheel (Y), persisted; default wide X coverage; center by strikes to avoid initial reflow on spot.
  - Scroll isolation: wheel over chart never scrolls modal/page; modal disables overflow while cursor is over the chart.
  - Canvas sized 640×300 with extended X/Y coverage so full payoff fits.

Note: Acceptance for milestones 5–7 updated to include favorites/sorting and unified View with zoom/export.

---

## Change Log — 2025-09-12

Deep overhaul of PositionView (unified chart) and related UX. The following brings the product to a robust, reproducible spec for payoff/T+0 visualization and interaction.

- One chart for all constructs
  - Removed SpreadView entirely. Both vertical spreads and arbitrary multi‑leg positions open the same PositionView.
  - SpreadTable now adapts spread legs into PositionView format preserving net entry attribution.

- Time modeling & slider behavior
  - Time axis references the latest (max) expiry among legs, not the nearest.
  - For each leg: T = max(0, T_full_leg × (1 − timePos)), so earlier expiries naturally drop out while later legs continue to evolve up to the last expiry.
  - T+0 curve (BS sum) disappears on the calendar day of the latest expiry (DTE_latest ≤ 0).
  - Slider moved next to Rate (r), compact width (≈220px), step 0.001, snap to 1 when close to end. On zero‑DTE day, slider min/value force to 1.
  - Minimum allowed time position respects elapsed time since createdAt → latest expiry (cannot scrub into the past). Persists and updates every minute.

- Payoff and T+0 curves
  - Expiry payoff shown as orange dashed line; T+0 shown as blue line (optional visibility via checkboxes).
  - T+0 is vertically anchored to match actual PnL (netEntry − netMid) at current spot; anchor decays to 0 as timePos → 1 to converge with expiry payoff.
  - Y scale computed from expiry payoff for clarity (optional fit‑both removed as low value add).

- Break‑even points (BE)
  - Dynamic BE for T+0: blue dashed verticals that move with time/IV; include a rotated label “Breakeven Point NN.NN%”.
    - Label styling: bold, letterSpacing 0.8px, light gray (#c6c6c6), positioned ~28% above bottom, percent sign rule: if position PnL > 0 show a leading minus (−), else no sign.
  - Static BE for expiry: yellow dashed verticals and y=0 markers; shown only when T‑curve is hidden (Show T‑curve unchecked) to avoid clutter.

- Axes, markers, tooltip
  - Y axis labeled “PNL” with computed ticks and numeric labels; y=0 dashed guide retained.
  - Strike markers (vertical dashed grays), spot marker (green dashed vertical). Per‑leg badges at top: L/S + C/P × qty with side‑based color.
  - Tooltip redesigned: label “Price” (not “S”), translucent background (rgba(0,0,0,0.25)), width 120px, font 15px with increased line spacing.

- Layout polish
  - Left legend labels “Today/Expiry” removed per request (curves and tooltip suffice).
  - Metric table back to compact grid under chart; reduced gaps and font, min column width so it occupies less space while remaining readable.

- Persistence (per position)
  - Persist per‑position view state via localStorage map `position-view-ui-bypos-v1`, keyed by a stable signature of legs (side,symbol,type,strike,expiry,qty).
  - Saved/restored fields: xZoom, yZoom, timePos, ivShift, rPct, showT0, showExpiry.
  - Global UI prefs remain in `position-view-ui-v1`.

- Scrolling behavior
  - Modal retains `overflow:auto` at all times (scrollbars visible). Wheel events over SVG are prevented to keep page from scrolling while interacting with the chart. Global wheel capture performs X/Y zoom (Shift toggles axis).

Implications
- Users can analyze any construction with legs expiring on different dates; the T+0 curve behaves realistically across the whole life of the longest leg.
- Breakeven visualization now answers the “today vs expiry” question directly and cleanly.
- Per‑position persistence makes “come back later” workflows seamless.
- The chart and UI states are sufficiently standardized to be rebuilt from this plan and the PRD.

---

## Reference Diagrams — Rendering and Interaction

### A) Rendering pipeline (per frame / dependency change)

1) Inputs
   - Legs[] (side, type, strike, expiryMs, qty, entryPrice)
   - Live tickers map (bid/ask, markIv, greeks, indexPrice)
   - UI state (timePos, ivShift, rPct, xZoom, yZoom, showT0/showExpiry)
2) Derived “calc” snapshot
   - netEntry, netMid, pnl, greeks sum, spot (from any leg indexPrice)
3) Domain (X/Y)
   - X base from spot (±50%) or strikes fallback; zoomed by xZoom
   - Y from expiry payoff range (yLow..yHigh) with padding; zoomed by yZoom
4) Payoff at expiry (vector expVals over X)
   - valueAt(S) = netEntry − Σ(sign × intrinsic(S,K,type) × qty)
5) Time model
   - latestMs = max(expiryMs of all legs)
   - For leg L: T_full = max(0, (L.expiryMs − now)/Year), T = max(0, T_full × (1 − timePos))
6) T+0 (vector nowVals over X)
   - price_L = BS(type, S, K, T, sigma, r)
   - val(S) = Σ(sign × price_L × qty), pnl_model(S) = netEntry − val(S)
   - Anchor at spot S0: offset = (pnl_actual(S0) − pnl_model(S0)) × (1 − timePos)
   - T+0(S) = pnl_model(S) + offset
7) Break‑even detection (zero crossings)
   - Scan neighbors i−1,i; linear interpolate Sx where y passes 0
   - Do this for expVals (static BE) and nowVals (dynamic BE)
8) Render
   - Curves (expiry/T+0), axes/ticks, strikes/spot, BE lines, leg badges
   - Tooltip (Price/Today/Expiry) and hover guides

### B) Tooltip and hover

```
mouseMove(x)
  → S = unscaleX(x)
  → pnlExpiry(S) via intrinsic
  → pnlNow(S) via BS (if latest DTE > 0)
  → setHover({ S, pnlExpiry, pnlNow })
```

### C) Persistence (per position)

```
key = hash(legs: side|symbol|type|strike|expiry|qty)
onOpen:
  state = map[key]
  if state: restore xZoom,yZoom,timePos,ivShift,rPct,showT0,showExpiry
onChange(xZoom|yZoom|timePos|ivShift|rPct|showT0|showExpiry):
  map[key] = state; save to localStorage
```

## Tech stack & conventions
- Frontend: React + TypeScript + Vite
- State: Zustand with `persist` (localStorage)
- Styles: lightweight CSS (system theme); no UI kit
- Data: Bybit public REST/WS (no keys); dev proxy optional (Vite)
- Time: display in user locale; DTE from epoch ms

---

## Milestone 0 — Project scaffold
**Goal**: Bootstrapped repo with tooling and empty app shell.

**Tasks**
1. Vite React TS scaffold
2. Install Tailwind, Zustand, React Query, zod, date-fns, axios
3. Configure ESLint/Prettier + scripts + Husky
4. Add `@/` alias

**Acceptance**
- `npm run dev` starts app

**Files**
- `/src/main.tsx`, `/src/App.tsx`
- `/src/styles/index.css` (Tailwind)
- `tsconfig.json` with baseUrl/paths

**Commands**
- `npm create vite@latest eth-options-dashboard -- --template react-ts`
- `npm i zustand @tanstack/react-query axios zod date-fns classnames`
- `npm i -D tailwindcss postcss autoprefixer eslint prettier husky lint-staged`
- `npx tailwindcss init -p`

---

## Milestone 1 — Domain types, utilities, and local storage
**Goal**: Define core types and math helpers.

**Tasks**
1. Types: `Greek`, `Leg`, `Spread`, `Portfolio` (per PRD)
2. Math utils: mid, spread price, PnL, ROC, breakeven, DTE
3. Greeks aggregation utils
4. Status evaluator with reason strings
5. Zustand store with `persist`

**Acceptance**
- Unit tests for math utils: sample fixtures produce expected metrics

**Files**
- `/src/utils/types.ts`
- `/src/store/store.ts`

---

## Milestone 2 — Data layer (Bybit REST + WS)
**Goal**: Fetch instruments, tickers, HV; subscribe to tickers for selected legs.

**Tasks**
1. REST wrapper (axios + interceptors, base URL, error mapping)
2. Endpoints:
   - `/v5/market/instruments-info?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT`
   - `/v5/market/tickers?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT[&expDate=…]`
   - `/v5/market/orderbook?category=option&symbol=…&settleCoin=USDT&quoteCoin=USDT&limit=25` (optional)
   - `/v5/market/historical-volatility?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT&period=30`
3. Normalizers to `Leg`; compute `mid` on ingest
4. Public WS client for tickers; subscription per symbol
5. In-memory cache: last tick per symbol
6. Символьный нормализатор `ensureUsdtSymbol` и миграции локальных данных, чтобы legacy `…-USDC` записи автоматически переводились в `…-USDT`

**Acceptance**
- Fetch chain for chosen expiry; log legs with greeks/IV
- WS updates flow into store (inspectable)

**Files**
- `/src/services/bybit.ts` (REST)
- `/src/services/ws.ts` (WS)

**Notes**
- If CORS blocks REST → optional **local proxy** (Milestone 2b): Node+Express `/api/*` → Bybit

---

## Milestone 3 — Market Context
**Goal**: Card with Spot ETH, ATM IV, HV30, nearest DTE.

**Tasks**
1. `MarketContextCard` component
2. Derive ATM IV (nearest-to-money strike)
3. Compute DTE to default nearest expiry
4. Show HV30 vs ATM IV

**Acceptance**
- Card shows values, auto-refreshes, handles loading/error

**Files**
- `/src/components/MarketContextCard.tsx`

---

## Milestone 4 — Add Position builder
**Goal**: Build positions from legs; autosave draft; save vertical or multi-leg.

**Tasks**
1. `AddSpreadDialog` with steps:
   - choose expiry → load chain
   - filter: PUT only, Δ range (0.15–0.30), min liquidity
   - pick short/long legs → preview metrics (W, mid, ROC)
   - enter **C_enter** (required), optional notes
2. Save to store and persist

**Acceptance**
- Can add a spread; it appears in table with computed metrics

**Files**
- `/src/components/AddPosition.tsx`

---

## Milestone 5 — Unified positions table
**Goal**: One table for verticals + multi-leg with greeks, liquidity, actions.

**Tasks**
1. `SpreadTable` with PRD columns
2. Row computes `priceNow`, `pnl`, `pnl%`, status
3. Subscribe to WS for both legs on mount; unsubscribe on unmount
4. Tooltips for status reason & liquidity
5. Row actions: “Mark closed”, “Roll/Close tips”

**Acceptance**
- Live updates change PnL and status colors without jank

**Files**
- `/src/components/UnifiedPositionsTable.tsx`

---

## Milestone 6 — Portfolio summary
**Goal**: Aggregated snapshot.

**Tasks**
1. `PortfolioSummary` card: count, sum MaxLoss, deposit share, totals greeks
2. Settings drawer for `depositUsd`

**Acceptance**
- Changing `depositUsd` updates share; totals match rows

**Files**
- `/src/components/PortfolioSummary.tsx`
- `/src/components/SettingsDrawer.tsx`

---

## Milestone 7 — Persistence & history (JSON/CSV)
**Goal**: Persist positions, show History.

**Tasks**
1. Zustand `persist` for spreads & settings
2. History table + CSV export

**Acceptance**
- Reload preserves data; closed spreads in History

**Files**
- `/src/utils/csv.ts`

---

## Milestone 8 — Error handling & polish
**Goal**: Robust UX.

**Tasks**
1. Skeletons for cards/tables
2. Unified error banner with retry
3. Debounce/throttle WS recomputes (≤ 8 fps)
4. Number formatters (USD, bp, %)

**Acceptance**
- Flaky network doesn’t crash UI; clear feedback

**Files**
- `/src/components/Skeleton.tsx`
- `/src/utils/format.ts`

---

## Milestone 9 — Edit & roll helper
**Goal**: Edit modal for multi-leg; roll helpers.

**Tasks**
1. Edit qty (0.1 step); remove legs
2. Add leg (Type/Expiry/Option/Side/Qty), entry by live mid
3. Roll helper: close old/open new legs (out/down/out&down)

**Acceptance**
- Can adjust legs and save; roll adds two legs with correct sides and entry mid

**Files**
- `/src/components/EditPositionModal.tsx`

---

## App layout & routing
- Single page with anchored sections
- Components: `PortfolioSummary`, `MarketContextCard`, `AddPosition`, `UnifiedPositionsTable`, `HelpModal`

**Files**
- `/src/App.tsx`
- `/src/routes/index.tsx` (optional)

---

## Configuration & .env
- `VITE_BYBIT_BASE=https://api.bybit.com`
- Optional proxy: `VITE_API_BASE=http://localhost:5174`

---

## Optional local proxy (Node)
Why: avoid CORS/rate limits; standardize responses.

Tasks
1. Express/Fastify routes: `/api/tickers`, `/api/hv30`, `/api/orderbook`
2. Cache 5–30s per route; rate-limit

Files
- `/server/index.ts`
- `/server/routes/*.ts`
- `/server/lib/bybit.ts`

---

## Completed (current status)
- Market context with WS spot, ATM IV (WS+REST), HV30 with fallback
- Add Position builder with Δ/OI/spread filters, fractional qty, draft autosave
- Save vertical or multi-leg; import/export JSON
- Unified positions table with greeks and liquidity, CSV export
- Edit modal with qty change, add/remove leg, Roll helper
- WS live updates + REST fallback for bid/ask

## Next improvements
- Sorting, search, column chooser; flash animation on value change
- Target-Δ auto-picker for builder and roll presets
- Per-leg commission input and net PnL; slippage estimator (orderbook)
- Alerts (Δshort, spot cross, DTE) with Notification API
- PWA (installable), offline caching of static assets
- Tests for math and reducers; storybook for visual regression

**Scripts**
- `npm run server:dev`

---

## Test plan (MVP)
- **Unit**: math/status utils with fixtures
- **Integration**: Bybit client → `Leg[]`; WS updates mutate store
- **E2E (light)**: add a spread from mocked chain; verify table updates with mocked WS

---

## Acceptance checklist (demo)
1. Add a spread (PUT 3200/3100, expiry X), enter `C_enter=60` → see W, MaxLoss, ROC, BE
2. Table shows live Mid_now and PnL changing with WS mock
3. Status toggles 🟢→🟡 when Δshort passes 0.31 (mock greeks)
4. Portfolio shows MaxLoss sum and % of deposit
5. Reload → spread persists; mark closed → appears in History

---

## Repository structure (suggested)
```
eth-options-dashboard/
  server/                 # optional proxy
  src/
    components/
    hooks/
    pages/
    services/
    store/
    types/
    utils/
  public/
  index.html
  package.json
  vite.config.ts
  tailwind.config.js
  tsconfig.json
```

---

## UI → Data Map (field ↔ source/formula)

Below is a mapping so Codex/CLI knows where UI fields come from (public Bybit REST/WS) and how to compute derived values. Use Bybit v5 response shapes.

### A) Market Context
| UI field | Source | Path | Transform |
|---|---|---|---|
| **ETH Spot** | REST `/v5/market/tickers?category=option&baseCoin=ETH&expDate=<chosen>` | `result.list[*].underlyingPrice` | Take the latest value; fallback mean or first. |
| **ATM IV** | Same tickers | `symbol`, `markIv`, `underlyingPrice` | Choose contract with minimal `abs(strike − underlyingPrice)`; use its `markIv`. Parse `strike` from `symbol` (e.g., `ETH-26SEP25-3200-P` → `3200`). |
| **HV 30d (last)** | REST `/v5/market/historical-volatility?category=option&baseCoin=ETH&period=30` | `result.list[-1].hv` | Take last point with timestamp. |
| **DTE (nearest)** | REST `/v5/market/instruments-info?category=option&baseCoin=ETH` | `result.list[*].deliveryTime` | `DTE = ceil((deliveryTime − nowMs)/86400000)` for the nearest future date. |

### B) Spreads Table (per position)
| UI field | Source | Path | Rule/Formula |
|---|---|---|---|
| **Expiry / DTE** | Instruments Info or parse `symbol` | `deliveryTime` | DTE as above. If missing, parse date from `symbol` and cross-ref. |
| **K_sell / K_buy** | Parse `symbol` | `ETH-<DDMONYY>-<STRIKE>-P` | `strike = Number(STRIKE)`; type from `-P/-C`. |
| **Entry credit (C_enter)** | ✍️ User | — | Stored locally when adding. |
| **Width (W)** | — | — | `W = K_sell − K_buy`. |
| **Current price (Mid_now)** | REST tickers for both legs | `bid1Price`, `ask1Price` | `mid(leg) = (bid1+ask1)/2`; `Mid_now = mid(short) − mid(long)`. |
| **MaxLoss** | — | — | `MaxLoss = W − C_enter`. |
| **ROC** | — | — | `ROC = C_enter / (W − C_enter)`. |
| **Breakeven (BE)** | — | — | `BE = K_sell − C_enter`. |
| **PnL (USD)** | REST + local | `Mid_now`, `C_enter` | `PnL = C_enter − Mid_now`. |
| **PnL % of C** | — | — | `PnL% = (PnL / C_enter) * 100`. |
| **Δ of short leg (Δshort_now)** | REST tickers (short leg) | `delta` | Trigger input. |
| **Θ of spread ($/day)** | REST tickers both legs | `theta` | `Θ_spread = Θ(short) − Θ(long)` (per contract). |
| **Aggregated greeks** | REST tickers both legs | `delta/gamma/vega/theta` | For each: `short − long`. |
| **Liquidity** | REST tickers | `bid1Price`, `ask1Price`, `openInterest` | `bidAsk = ask1 − bid1`; show `OI`. |
| **Status (🟢/🟡/🔴)** | Local logic | see Status § | `evaluateStatus(Δshort, loss, C_enter, DTE, Spot≤K_sell)`. |

### C) Portfolio Summary
| UI field | Source | Formula |
|---|---|---|
| **# spreads** | Local | `spreads.length` |
| **Total MaxLoss** | Local | `Σ (W − C_enter)` |
| **Share of deposit** | Local (`depositUsd`) | `Σ MaxLoss / depositUsd` |
| **Totals Δ/Γ/Vega/Θ** | Sum of spreads | `Σ greeks_spread` |

### D) Add Spread Dialog
| UI field | Source | Rule |
|---|---|---|
| **Expiry (selector)** | Instruments Info | List by `deliveryTime` + formatted date from `symbol`. |
| **Δ filter** | REST tickers | Keep PUT with `abs(delta) ∈ [0.15, 0.30]`. |
| **Liquidity filter** | REST tickers | `bid1>0`, `(ask1−bid1) ≤ threshold`, `OI ≥ threshold`. |
| **Preview credit/ROC** | Selected legs’ tickers + formulas | `mid`, `Mid_now`, `W`, `ROC`. |
| **C_enter (input)** | User | Required field. |

---

### E) Machine-readable map (JSON)
```json
{
  "market": {
    "spot": { "endpoint": "/v5/market/tickers", "params": { "category": "option", "baseCoin": "ETH" }, "path": "result.list[*].underlyingPrice", "reduce": "latest" },
    "atmIv": { "endpoint": "/v5/market/tickers", "params": { "category": "option", "baseCoin": "ETH", "expDate": "<EXP>" }, "selector": "atmByMinAbs(strike-underlyingPrice)", "path": "markIv" },
    "hv30": { "endpoint": "/v5/market/historical-volatility", "params": { "category": "option", "baseCoin": "ETH", "period": 30 }, "path": "result.list[-1].hv" },
    "dte": { "endpoint": "/v5/market/instruments-info", "params": { "category": "option", "baseCoin": "ETH" }, "path": "result.list[*].deliveryTime", "compute": "ceil((minFuture(deliveryTime)-nowMs)/86400000)" }
  },
  "spreadRow": {
    "kSell": { "from": "symbol", "compute": "parseStrike(symbol)" },
    "kBuy": { "from": "symbol", "compute": "parseStrike(symbol)" },
    "midShort": { "endpoint": "/v5/market/tickers", "params": { "category": "option", "symbol": "<SHORT>" }, "compute": "(bid1Price+ask1Price)/2" },
    "midLong": { "endpoint": "/v5/market/tickers", "params": { "category": "option", "symbol": "<LONG>" }, "compute": "(bid1Price+ask1Price)/2" },
    "priceNow": { "compute": "midShort - midLong" },
    "width": { "compute": "kSell - kBuy" },
    "maxLoss": { "compute": "width - cEnter" },
    "roc": { "compute": "cEnter / (width - cEnter)" },
    "breakeven": { "compute": "kSell - cEnter" },
    "pnl": { "compute": "cEnter - priceNow" },
    "pnlPctOfC": { "compute": "(pnl / cEnter) * 100" },
    "deltaShort": { "endpoint": "/v5/market/tickers", "params": { "category": "option", "symbol": "<SHORT>" }, "path": "delta" },
    "thetaSpread": { "endpoints": ["<SHORT>", "<LONG>"], "path": "theta", "compute": "thetaShort - thetaLong" },
    "liquidity": { "endpoint": "/v5/market/tickers", "params": { "category": "option", "symbols": ["<SHORT>", "<LONG>"] }, "compute": "{ bidAskShort: ask1Short-bid1Short, bidAskLong: ask1Long-bid1Long, oiShort, oiLong }" },
    "status": { "compute": "evaluateStatus(deltaShort, max(0, -pnl), cEnter, dte, spot<=kSell)" }
  }
}
```

### F) WS topics (optional later)
- Public: `tickers.<SYMBOL>` per leg; update `bid1/ask1`, `delta/theta`, `underlyingPrice`.
- Subscribe on row mount; unsubscribe on unmount.

---

## Change Log — 2025-09-12 (Session Addendum)

This addendum captures UI/data changes done during the latest session so the build can be reproduced from scratch.

- PositionView summary row (under chart)
  - Grid widened to 10 columns to fit key metrics on one line.
  - Reordered to group: Width, Net entry, Net mid, PnL ($) first; greeks next.

- Chart overlay (live)
  - Top-left overlay shows Spot (rounded, no decimals) and PnL ($, 2 decimals), updates live.
  - Spot source: option indexPrice (underlying) from option tickers. A temporary switch to spot WS was reverted.

- Per‑leg cards (View modal)
  - Compact font (−1.5px); leg title and date enlarged (+2px).
  - Two-row layout so all columns fit; Symbol spans both rows and wraps.
  - Added per‑leg PnL ($) = sgn × (entry − mid) × qty (sgn: +1 short, −1 long).
  - IV % with 1 decimal; priority chain:
    1) markIv (WS);
    2) implied from markPrice via BS inversion;
    3) average of IV(bid) and IV(ask) via BS inversion;
    4) implied from Mid;
    5) HV30.
  - Labels: `Δ (Delta)`, `Θ (Theta)`.

- Under-chart metrics table
  - Labels updated to `Δ (Delta)` and `Θ (Theta)`.

- Removed in View modal
  - Export SVG/PNG buttons removed.
  - Screenshot button/functionality removed.

- UnifiedPositionsTable
  - Kept compact `Δ` header (long label reverted) to preserve layout.
  - Liquidity badge (gray) next to `$maxSpread · OI min` with 4 grades:
    - Compute per leg: spread% = (ask − bid)/mid × 100; aggregate max spread% across legs, min OI across legs.
    - A: spread% < 1% and min OI ≥ 2000; B: spread% < 2% and min OI ≥ 1000; C: spread% < 3% and min OI ≥ 300; D: otherwise.

- Help modal
  - Documented badge rules, how spread%/OI are computed and aggregated across legs, and trading impact (slippage, execution, rolls).

Primary files touched: `src/components/PositionView.tsx`, `src/components/UnifiedPositionsTable.tsx`, `src/components/HelpModal.tsx`.
