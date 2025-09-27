# PRD — ETH Options Position Dashboard (MVP+)

## 1) Summary
Single-page local web app to monitor and manage ETH options on Bybit. **Все опционные данные берём только по USDT-settled контрактам**. Supports PUT/CALL vertical credit spreads and multi-leg positions (e.g., calendars). Shows market context, live quotes/greeks (WS), unified positions with PnL/greeks/liquidity, payoff for verticals, portfolio aggregates. Public Bybit REST/WS only; user provides entry and qty; local persistence.

---

## Recent Updates (2025-09-13)
- Миграция на USDT-settled опционы Bybit: REST и WS запросы добавляют `settleCoin=USDT`/`quoteCoin=USDT`, локально фильтруем символы `…-USDT`.
- Добавлен нормализатор `ensureUsdtSymbol` и миграция Zustand `version=2`, автоматически переводящие старые сохранённые символы `…-USDC`/без суффикса в формат `…-USDT`.
- UI (драфты, дополнительные страйки из тикеров) дописывает суффикс `-USDT`, все greeks/PnL теперь считаются по USDT данным.

---

## Recent Updates (2025-09-11)
- Accurate per-leg entries (verticals store entryShort/entryLong; multi-leg per leg). Signs fixed for Δ/Θ/Vega; Γ removed from UI.
- IV backfill hardened (WS merge safe; REST supplements missing markIv/greeks/OI).
- Strategy detection for common 1–4-leg patterns (verticals credit/debit bull/bear; calendars/diagonals; straddle/strangle; iron butterfly/condor; same-type condor; box; double calendar/diagonal).
- Favorites: ☆/★ with tab; sorting by Date/PnL/Theta/Expiry with asc/desc; preferences persisted.
- Unified View for all constructs: expiry + T-curve (BS sum), strikes/spot, BE markers, shading, width (symmetric); export SVG/PNG; mouse-wheel zoom (X), Shift+wheel (Y); strict scroll isolation.

## Recent Updates (2025-09-12)
- Unified chart (PositionView) for all positions; SpreadView removed. Spread rows open PositionView with proper per‑leg entry attribution.
- Time model now uses the latest (max) expiry among legs. The Time slider scrubs from “Today → last expiry”. Each leg’s T decays independently and clamps at 0 when its own expiry is reached.
- T+0 (Black–Scholes sum) is vertically anchored to actual PnL at spot (netEntry − netMid); the anchor decays to 0 as time approaches expiry, ensuring T+0 converges to the payoff curve. T+0 hidden on the calendar day of the latest expiry (DTE_latest ≤ 0).
- Dynamic BE for T+0: blue dashed verticals with rotated label “Breakeven Point X.XX%”. Sign rule: if current position PnL > 0 show a leading minus; otherwise no sign. Label style: bold, letterSpacing 0.8px, #c6c6c6, placed ≈28% above the bottom.
- Expiry BE (yellow dashed) and BE dots at y=0 appear only when the T‑curve is hidden, to reduce clutter.
- Y axis labeled “PNL”, with computed tick labels and a dashed y=0 baseline.
- Tooltip: shows “Price / Today / Expiry”; translucent dark background (rgba(0,0,0,0.25)), ~120px width, font 15px, larger line spacing.
- Controls: Rate (r), IV shift, Show T‑curve, Show expiry payoff; Time slider next to Rate, step 0.001 with snap to 1 near end; on DTE_latest=0 slider ends at 1.
- Per‑position persistence (localStorage `position-view-ui-bypos-v1`): xZoom, yZoom, timePos, ivShift, rPct, showT0, showExpiry; keyed by stable leg signature. Global defaults remain in `position-view-ui-v1`.
- Scrolling: modal uses `overflow:auto` at all times; wheel over SVG is intercepted; wheel zooms X, Shift+wheel zooms Y.

## Recent Updates (2025-09-12 — Session Addendum)
- PositionView summary grid widened to 10 columns; metrics reordered so Width, Net entry, Net mid, PnL ($) идут первыми; greeks после.
- Chart overlay (в левом верхнем углу графика): Spot без десятичных и PnL ($) — обновляются в реальном времени; источник Spot — option indexPrice (underlying) из опционных тикеров.
- Пер‑leg карточки в View:
  - Уменьшен базовый шрифт (−1.5px), увеличены название ноги и дата (+2px).
  - Двухрядная раскладка; колонка Symbol занимает оба ряда (gridRow span 2), остальное распределено по двум строкам.
  - Добавлен столбец PnL ($) по каждой ноге: sgn × (entry − mid) × qty, где sgn=+1 для short, −1 для long.
  - IV %: формат 1 знак после запятой; порядок источников:
    1) markIv (WS);
    2) инверсия BS из markPrice ("fair price");
    3) среднее IV из Bid/Ask (инверсия BS по каждой и усреднение);
    4) IV из Mid; 5) HV30.
  - Подписи греков: Δ (Delta), Θ (Theta).
- Под таблицей графика: греческие метрики подписаны как Δ (Delta) и Θ (Theta).
- Удалены из View: кнопки Export SVG/PNG и экспериментальная кнопка Screenshot (и код захвата).
- UnifiedPositionsTable: 
  - Оставлен компактный заголовок Δ (без словаря) для сохранения ширины.
  - Добавлен серый бейдж ликвидности рядом с "$maxSpread · OI min":
    - Расчёт: по каждой ноге spread% = (Ask − Bid)/Mid × 100; агрегируем max spread% по ногам и min OI по ногам.
    - Правила: A (spread% < 1% и min OI ≥ 2000), B (< 2% и ≥ 1000), C (< 3% и ≥ 300), D (иначе).
- Справка: добавлен раздел про бэйджи ликвидности, методику расчёта (максимум spread% и минимум OI по ногам) и влияние на торговлю (проскальзывание, исполнение, роллы).

## 2) Goals
- Unified dashboard for verticals and multi-leg positions.
- Decide quickly: hold / take profit / roll / close.
- Local (no keys), WS live; REST fallback for robustness.
- Minimal settings; clear visuals.

### Non-Goals (v1)
- Placing/closing live orders.
- Private account balances/margins (v2+ candidate).
- Native mobile apps.
- Non-ETH instruments.

---

## 3) Target user & use cases
- Trader (beginner → intermediate) on Bybit.
- Use cases:
  1) Status: live PnL, Δ/Γ/Vega/Θ, DTE, liquidity; action hints.
  2) Build: add legs with fractional qty; save as vertical or multi-leg.
  3) Control: watch IV/HV, skew, Δ drift; use roll helper.

---

## 4) Scope (MVP+)
### 4.1 Market Context
- ETH Spot (last, 24h%) — WS.
- ATM IV — nearest-to-money on nearest expiry (WS + REST init).
- HV 30d — REST; fallback to ATM IV if missing.
- DTE for nearest expiry; hour-based refresh.

### 4.2 Unified “My Positions” table
- Legs, Expiry/DTE, Net entry/mid/PnL, Δ/Vega/Θ (sum), Liquidity (max bid-ask, min OI). Γ скрыта.
- For verticals: K_sell/K_buy, Width, MaxLoss, Breakeven, Δshort, Θ.
- Strategy name auto-detected (1–4 legs): verticals, straddle/strangle, calendars/diagonals, iron condor/butterfly, same-type condor, box, double calendar/diagonal.
- Favorites: ☆/★ toggle, Favorites tab; sorting by Date/PnL/Theta/Expiry with asc/desc; prefs persisted.
- Actions: View (unified), Edit (multi-leg), Mark closed, Delete, Export CSV.

### 4.3 Portfolio Summary
- Count of open positions.
- Total MaxLoss (verticals only) and share of deposit.
- Deposit editable; greeks totals (v2).

### 4.4 Add Position (builder)
- Type (PUT/CALL) → Expiry → Option (strike with live mid/Δ/OI) → Qty (step 0.1) → Add Short/Long.
- Filters: Δ range, min OI, max bid-ask spread.
- Draft autosave (localStorage); Clear draft.
- Save: vertical → spread; else → multi-leg position.

### 4.5 Edit (multi-leg)
- Change qty (0.1 step), remove legs, add legs with live entry mid.
- Roll helper: pick leg → target expiry → target option; adds pair (close old/open new) with entry mid.

### 4.6 History & export
- Show closed via toggle.
- Export CSV (positions list), Export/Import JSON (backup in Portfolio).

---

## 5) Data sources (Bybit public)
- Instruments: expiries, steps.
- Tickers (options): bid/ask (fallback: bestBid/bestAsk), greeks, markIv, underlyingPrice, OI.
- Spot WS: ETHUSDT last/24h%.
- Historical Volatility: HV 30d (hourly REST).
> No API keys. All data via public endpoints.

---

## 6) Key formulas & logic
### 6.1 Mid, spreads, multi-leg
- `mid = (bid + ask)/2` (fallback: mark/last).
- Vertical PUT: `Price_now = mid(short) − mid(long)`, `BE = K_sell − C_enter`.
- Vertical CALL: `BE = K_sell + C_enter`.
- `W = |K_sell − K_buy|`, `MaxLoss_per = W − C_enter`, totals scale by `qty`.
- Multi-leg net: `NetEntry = Σ(sign × entryPrice × qty)`, `NetMid = Σ(sign × mid × qty)`, `PnL = NetEntry − NetMid` (sign: short +1, long −1).

### 6.2 Greeks aggregation
- Per leg: Δ/Γ/Vega/Θ from ticker.
- Vertical: Δ(short) − Δ(long); similarly Γ/Vega/Θ.
- Multi-leg: sum with sign (long +, short −) and qty.
- Triggers use |Δshort| (PUT/CALL consistent).

### 6.3 Traffic-light triggers (verticals)
- 🟢 OK: `|Δshort| ≤ 0.30` AND `UnrealizedLoss < 1×C_enter` AND `DTE > 10`.
- 🟡 Attention: `0.31–0.35` OR `Loss ≈ 1.0–1.5×C_enter` OR `7–10 DTE`.
- 🔴 Action: `|Δshort| > 0.35` OR `Spot crosses short strike` OR `Loss ≥ 1.5–2.0×C_enter` OR `DTE ≤ 7`.

### 6.4 ATM IV
- Pick strike closest to underlying on the chosen expiry; use its `markIv`.

---

## 7) UI/UX
- Single page: Market, Add Position, My Positions, Portfolio.
- Sticky headers; responsive; light/dark; USD.
- View (payoff) for all constructs:
  - Curves: Expiry payoff (orange dashed), T+0 (blue), togglable.
  - Time: slider from Today to latest expiry; leg‑wise T clamps at own expiry; T+0 hidden on last DTE day.
  - IV & Rate: IV shift slider; numeric Rate (r).
  - BE: dynamic BE for T+0 (blue dashed with rotated percentage label); static BE for expiry (yellow dashed) when T‑curve hidden.
  - Axes & markers: Y axis “PNL” with ticks; y=0 baseline; green spot line; gray strike lines; per‑leg badges (L/S C/P × qty).
 - Tooltip: “Price / Today / Expiry” with translucent background; compact width; larger font.
  - Zoom & export: wheel (X), Shift+wheel (Y); export SVG/PNG. Edit for multi‑leg with Roll helper.

---

## 8) Алгоритмы (формулы и правила)

### 8.1 Обозначения
- Legs: L ∈ {1..N}, у каждой: side ∈ {long,short}, type ∈ {C,P}, strike K, expiry t_exp, qty q, entryPrice e.
- Знак позиции: sign(L) = +1 для short, −1 для long.
- Год: Year = 365×24×60×60×1000 мс.
  - Сотые доли: IV в процентах переводится в σ = IV/100.

---

## IF Rule Builder Modal

### Purpose & entry point
- Allow users to attach alert/automation conditions to a position (row in Unified Positions table) without leaving the dashboard.
- Launch via “IF” action button on a row; modal overlays viewport (fixed, centered, 860px width, 85% height cap).
- All state lives locally; rules persist per position id in `localStorage['if-rules-v3']` (JSON map `{ [rowId]: IfRule }`).

### Data structures (TypeScript)
- `IfOperand`:
  - `number`: `{ kind: 'number', value: number }`.
  - `position`: `{ kind: 'position', metric: string }` — metrics enumerated in `posParams` (spot, netEntry, netMid, pnl, pnlPctMax, delta, vega, theta, dte).
  - `leg`: `{ kind: 'leg', metric: string, legMode: 'current' | 'symbol', symbol?: string }` — metrics enumerated in `legParams` (spot, bid, ask, mid, entry, pnlLeg, ivPct, vega, delta, theta, oi, dSigma).
- `IfSide`: `{ base: IfOperand, op?: { operator: '+' | '-' | '*' | '/', operand: IfOperand } }` (single arithmetic extension allowed).
- `IfCond`: `{ left: IfSide, cmp: '>' | '<' | '=' | '>=' | '<=', right: IfSide }`.
- `IfChain`: `{ scope: 'position' | 'leg', legSymbol?: string, conds: Array<{ conj?: 'AND' | 'OR', cond: IfCond }> }` — represents a block; leg blocks may target a specific leg symbol or “any leg”.
- `IfRule`: `{ chains: Array<{ conj?: 'AND' | 'OR', chain: IfChain }> }` — top-level conjunctions combine blocks left-to-right.
- `IfConditionTemplate`: `{ name: string, scope: 'position' | 'leg', cond: IfCond, legSymbol?: string | null }` stored in `localStorage['if-templates-v1']`.

### Sanitisation & migration
- `migrateRule(initial, legOptions)` converts legacy payloads into the current structure, guaranteeing at least one chain/condition.
- `sanitizeOperand/Side/Cond/Chain` enforce:
  - Numeric operands default to 0 when invalid.
  - Unknown metrics revert to defaults (spot/mid).
  - Leg operands outside a leg scope force `legMode: 'symbol'`.
  - Leg symbols validated against `legOptions`; if missing, select first available; `null` preserved to mean “Any leg”.
  - When arithmetic operator is `'/'`, the resulting side’s `unit` metadata is dropped (ratios have no `$`/`%`).
- New chains created via `makeDefaultChain(scope)` spawn a single condition using scope-appropriate operands (`position spot` > `number 0` or `leg current mid` > `0`).

### UI layout (top → bottom)
1. **Header**: title `IF · {strategyName}`; right-aligned `Close` button.
2. **Intro text**: guidance on building conditions.
3. **Templates section**:
   - Prefix label “Templates:”. Buttons labelled `⭐ {name}` apply stored conditions.
   - Manage toggle reveals selection checkboxes + “Delete selected / Delete all”. Per-template “×” removes single entry after confirmation.
   - Template callbacks (`onSaveTemplate`, `onDeleteTemplate`, `onDeleteTemplates`) bubble to `UnifiedPositionsTable` which mutates `if-templates-v1` and syncs state.
4. **Condition overview**:
   - Ordered list mirroring the actual rule (chains/conditions).
   - Between entries, place uppercase conjunction label (`AND`/`OR`) when preceding clause joins via a connector.
   - Each row contains:
     - Ghost “×” button removing the referenced condition (delegates to `removeCondition(chainIdx, condIdx)`; deleting the last condition drops the chain).
     - Caption `{Block label}:` where block label is “Position block”, “Leg block (SYMBOL)”, or “Leg block (any leg)”.
     - Human-readable sentence built from highlighted operands (bold + light-brown `#b48b5a` for metric phrases). Division sides never display currency or percent units.
     - Live indicator `→ value` where `value` = latest left-side evaluation `lhs` with merged units. Colour: green (`#2ecc71`) if condition satisfied, grey otherwise. When `evalCondDetails` is unavailable or `lhs` undefined, show em dash `—`.
5. **Rule editor** (renders each chain):
   - Chain header: optional conjunction dropdown (AND/OR) for chains beyond the first, “Block” label, scope selector (`Position`/`Legs`), optional leg symbol dropdown (`Any leg` + options), conditions count, “Remove block”.
   - Conditions list: each entry is a dashed card containing optional conjunction selector, three columns (Left side / Comparator / Right side), a satisfaction dot ( green when `evalCondLive` true), “Save template” button (prompts for name, then clones sanitized cond) and “Remove”.
   - `renderOperandEditor` per column supports type switcher, number input, metric dropdowns, and a secondary operand (with operator select + remove button). Leg operands inside leg scope can pick “This leg” (current leg) or a concrete symbol; outside, they always pick a symbol.
   - “+ Add condition” button appends sanitized default cond with conjunction `AND`.
6. **Footer controls**: “+ Leg block”, “+ Position block”, `Cancel`, `Save`.

### Template flow
- Save: prompts for template name → clones sanitized condition JSON → attaches scope + `legSymbol` (`undefined` omitted, `null` = any) → emits via `onSaveTemplate` → parent deduplicates by `(name, scope)` before persisting.
- Apply: ensures a matching scope chain exists (creating default if not). For leg scope, resolved `legSymbol` priority: saved value → previously selected chain symbol → operand inference (`inferLegSymbolFromCond`). The merged chain is passed through `sanitizeChain` before state update.
- Manage mode: Multi-selection uses `selectedTemplates` Set keyed as `${scope}:${name}`.

### Evaluation + live data
- Parent supplies two callbacks:
  - `evalCondLive({ scope, legSymbol, cond })` → boolean; used for status dots and fallback satisfaction when detailed snapshot absent.
  - `evalCondDetails({ scope, legSymbol, cond })` → `{ satisfied, lhs, rhs } | undefined`; used in overview arrow. For leg scope, function iterates matching legs; returns first satisfying snapshot or, if none satisfy, the last evaluated snapshot (so arrow still reflects actual value).
- `UnifiedPositionsTable` computes these via helpers:
  - Build `PositionEvalContext` (spot, leg cache, BS inputs) from current row.
  - `evaluateCondSnapshot` calculates both sides with `evalSide` (supports numbers, position metrics, leg metrics, and arithmetic). Ratios treat divisor close to zero as undefined.
  - For leg-scope snapshots, loop legs filtered by `legSymbol` (or all); compute metrics via `buildLegMetrics`; stop on first satisfied cond.
- The modal reuses `evalCondLive` for the green status label next to the Save Template/Remove buttons.

### Persistence & integration
- Rules saved per row through `onSave` (modal re-sanitises before emit). Cancelling discards edits.
- Templates persisted globally per user in localStorage `if-templates-v1` (array of `IfConditionTemplate`). Loader normalises legacy entries (missing `legSymbol` -> undefined; any string -> preserved; explicit null allowed).
- When applying a template to a row missing that leg symbol, fallback selects first available symbol; if none, remains “Any leg”.
- Condition overview uses `React.Fragment` to align arrow + text and shares the same removal handler as the cards to avoid divergence.

### Accessibility & usability
- All interactive elements are buttons/selects; ghost buttons rely on textual labels (“Close”, “Remove block”, etc.).
- Keyboard: default browser focus order; removal buttons respond to Enter/Space.
- Visual cues: live satisfaction dot and arrow change colour in real time; overview conjunction lines keep logical clarity; block counters show condition count.

### Future extensions (out of scope now)
- Background alerts (notifications) once condition satisfied.
- Additional operands (e.g., custom expressions, portfolio metrics).
- Multi-operand arithmetic (beyond single op) and parentheses.
- Server sync of templates/rules.

---

## Project proposals — 2025-09-15

### Сильные стороны
- Четкая предметная область: локальное SPA для ETH‑опционов (Bybit) с ясной моделью данных (спреды, многоногие позиции) и локальной персистентностью.
- Зрелая архитектура фронтенда: React + TypeScript + Vite, Zustand с persist; понятное разделение слоев (services/store/components/utils), dev‑proxy в Vite.
- Богатая функциональность: Market (Spot/ATM IV/HV30/DTE), добавление вертикалей и произвольных конструкций, фильтры по Δ/OI/спреду, перп; единая таблица позиций (PnL/greeks, бэйдж ликвидности, избранное, сортировки, экспорт CSV); единый View‑модал с payoff/T+0, якорением к фактическому PnL, тайм‑слайдером, сдвигом IV и r, зумом и пер‑позиционной персистентностью.
- Устойчивость к «дырам» в данных: аккуратный merge WS/REST без затирания валидных значений; расчет IV несколькими путями (markIv → из markPrice → bid/ask → mid → HV30).
- Внутренние алгоритмы: BS‑утилиты (цена/iv), детектор стратегий, расчет ликвидности и Δσ, корректные формулы PnL/extrema.
- Документация: README, PRD и план развития с зафиксированными обновлениями.

### Слабые стороны
- Отсутствуют тесты и статический анализ в CI: нет unit‑тестов для bs/iv/детектора, нет ESLint/Prettier/линтинга и автоматических проверок.
- Крупные компоненты и дублирование вычислительной логики (iv, dSigma, PnL) между таблицей и модалом; расчеты стоит вынести в `utils`/hooks для переиспользования и тестируемости.
- Производительность при масштабе: множество WS‑подписок и периодические REST‑опросы; нет виртуализации таблиц; возможны лишние перерендеры.
- Портфельные агрегаты неполны: `PortfolioSummary` считает MaxLoss только по вертикалям, тогда как основная таблица объединяет vertical и multi‑leg — возможна путаница.
- Обработка ошибок/UX: WS/REST ошибки часто «молчат», мало скелетонов и явных статусов соединения.
- Типизация ответов Bybit местами ослаблена (any/свободные мапы); можно усилить типы и нормализацию.
- Стайлинг базовый (инлайн‑стили), что усложнит дальнейшее масштабирование тем/адаптива.

### Прогноз развития
- Короткий горизонт (1–2 спринта)
  - Вынести расчеты PnL/IV/Δσ/liq/extrema/BE в `utils`, покрыть unit‑тестами; синхронизировать использование между таблицей и модалом.
  - Привести портфельные агрегаты к единой модели (учет multi‑leg, пометки unbounded profit/loss).
  - Оптимизировать подписки и обновления стейта: дедуп символов, батч‑мердж, мемуизация; рассмотреть React Query для REST‑кэша.
  - Улучшить UX ошибок/загрузки: скелетоны, видимые статусы (WS/REST/Disconnected/Retry).
- Средний горизонт
  - История сделок/закрытий, экспорт/импорт с версионированием; IndexedDB для объемных локальных данных.
  - Виртуализация таблиц, профилирование рендера; декомпозиция крупных компонентов, lazy‑chunks.
  - IF‑правила/алерты в фоне: локальные нотификации, подсветка ног/позиций; пресеты правил.
  - Расширение унификации: поддержка других базовых активов (напр. BTC), выбор баз/локализация.
- Дальний горизонт
  - What‑if/стресс‑тесты портфеля (сдвиги IV/Spot), рекомендации роллов.
  - Опциональный бэкенд: серверный кэш рын. данных/агрегации, мульти‑устройства и шаринг, сохраняя оффлайн‑режим.


### 8.2 Базовые функции
- BS(type,S,K,T,σ,r): Black–Scholes цена call/put (см. utils/bs.ts).
- Intrinsic(type,S,K) = max(0, S−K) для Call; max(0, K−S) для Put.

### 8.3 Итоговые величины по позиции
- NetEntry = Σ_L ( sign(L) × e_L × q_L )
- NetMid = Σ_L ( sign(L) × mid_L × q_L )
- PnL = NetEntry − NetMid

### 8.4 Временная модель (latest‑expiry)
- t_last = max_L (t_exp_L)
- timePos ∈ [0..1] интерполирует “сегодня” → t_last
- Для каждой ноги L:
  - T_full(L) = max(0, (t_exp_L − now)/Year)
  - T(L) = max(0, T_full(L) × (1 − timePos)) — отдельные ноги «умирают» в свою дату

### 8.5 Кривые
1) Payoff на экспирации:
   - payoff(S) = NetEntry − Σ_L ( sign(L) × Intrinsic(type_L, S, K_L) × q_L )
2) T+0 (теоретическая «сегодня»):
   - val(S) = Σ_L ( sign(L) × BS(type_L, S, K_L, T(L), σ_L, r) × q_L )
   - pnl_model(S) = NetEntry − val(S)
   - Якорение по споту S0: offset = (PnL_actual(S0) − pnl_model(S0)) × (1 − timePos)
   - T0(S) = pnl_model(S) + offset
3) Скрытие T+0: при DTE_last ≤ 0 (floor((t_last − now)/день) ≤ 0) — не рисуем.

### 8.6 Точки безубыточности (BE)
1) Для набора значений y[i] по сетке S[i] ищем нули:
   - если y[i−1] и y[i] разного знака, Sx = S[i−1] + (0 − y[i−1]) × (S[i] − S[i−1])/(y[i] − y[i−1])
2) Static BE = нули payoff(S)
3) Dynamic BE = нули T0(S)
4) Подпись процента к BE (для Dynamic):
   - diffPct = |(S_BE − S_spot)/S_spot| × 100
   - Знак: если текущая позиция в прибыли (PnL > 0) → добавить ‘−’, иначе без знака.

### 8.7 Оси и масштабирование
- X: при наличии spot — [0.5×spot .. 1.5×spot], иначе fallback от страйков; зумирует xZoom.
- Y: из диапазона payoff с паддингом; зумирует yZoom.
- Оси имеют тики по “красивым” шагам (1/2/2.5/5/10 * 10^k).

---

## 9) Схемы/диаграммы последовательности

### 9.1 Рендер графика (упрощённо)
```
derive(calc from tickers)
compute X-domain (spot±50% | strikes)
sample S-grid
expVals = payoff(S)
for each leg: T_full, T(L) = T_full*(1-timePos)
nowVals = T0(S) with anchor
be_exp  = zeros(expVals)
be_now  = zeros(nowVals)
render axes/curves/markers
render BE lines (now or exp depending on Show T-curve)
```

### 9.2 Обработка курсора (tooltip)
```
mousemove → S
  pnl_exp = payoff(S)
  pnl_now = (DTE_last>0 ? T0(S) : undefined)
  show tooltip: Price / Today / Expiry
```
- Liquidity column: `$max spread · OI min`; REST fallback if WS lacks bid/ask.

---

## 8) Performance & refresh
- WS for options and spot; resubscribe on reconnect; ping keepalive.
- REST fallback for bid/ask every 30s; HV30 every 10min.
- Throttle UI recompute to ≤ 8 fps.

---

## 9) Local-first architecture
- Frontend: React + TypeScript + Vite (no backend required).
- State: Zustand with persist (localStorage).
- Storage: positions (spreads + multi-leg), settings, Add Position draft.
- Optional proxy (later) to mitigate CORS and rate-limits.

---

## 10) Acceptance Criteria
1) Market shows Spot, ATM IV, HV30 (or fallback), DTE; updates live.
2) Add Position builds legs with fractional qty, autosaves draft, and saves verticals/multi-leg.
3) My Positions shows live Net entry/mid/PnL, greeks, liquidity; extras for verticals; actions work.
4) Portfolio shows count, MaxLoss (verticals) and deposit share.
5) Export CSV from positions; Export/Import JSON from Portfolio.
6) Data persists across reloads; UI handles flaky network without crashes.

---

## 11) Proposed improvements
- Sorting, search, column chooser; visual flash on changes.
- Target-Δ filters and roll presets (auto-pick K with Δ≈0.20; out/down/out&down).
- Per-leg commissions and net PnL; slippage with orderbook (25 levels).
- Alerts (Δshort, spot cross, DTE) via Notification API; e-mail/webhook optional.
- PWA (offline shell), installable app.
- Tests for math/formatting; storybook for components.

### 11.1 Max/Min PnL Since Entry (View modal)
- **Goal**: показать «лучшую» и «худшую» нереализованную прибыль позиции с момента открытия (чтобы пользователь понимал, насколько сильно колебался результат).
- **Data capture**:
  - При каждом обновлении котировок вычислять текущий net PnL (mid или exec в зависимости от режима).
  - В zustand-сторе хранить `maxPnl`, `minPnl`, `maxPnlAt`, `minPnlAt` для каждой позиции; инициализировать при добавлении/импорте.
  - Обновлять поля, если текущее значение устанавливает новый экстремум; персистить вместе с остальными данными.
- **UI/Labeling**:
  - Добавить блок в `PositionView` (правый сайдбар): `Max PnL (since entry)`, `Min PnL (since entry)` + время, когда экстремум был достигнут.
  - Использовать текущий режим расчёта PnL (mid/exec) и подсказку, что значения относятся к позиции целиком.
- **Edge cases**:
  - Для новых позиций экстремумы ≈ текущему PnL → можно скрывать или отмечать «нет данных».
  - Обрабатывать закрытые позиции (либо фиксировать последнюю пару значений, либо сбрасывать при повторном открытии).
- **Next steps**: до реализации нужны вспомогательные функции расчёта текущего PnL на стороне store и миграция сохранённого состояния.

---

## 12) Rolling UX — mini-guide (with math)

### 12.1 Overview
- Roll = закрыть старую ногу/спред и открыть новую конфигурацию, чтобы получить доп. кредит, время или улучшить BE.
- В приложении роллы оформляются через Edit → Roll helper: добавляются 2 ноги — close old (противоположная сторона) и open new (искомая нога).
- Типовые сценарии: Roll out (дальше по времени), Roll down (ниже по страйку для PUT; выше для CALL), Roll down & out (совместить).

### 12.2 Базовые определения
- CloseCost (per contract) = текущий mid закрываемой ноги/спреда.
- NewCredit (per contract) = текущий mid новой ноги/спреда, получаемый при открытии.
- NetCredit (per contract) = NewCredit − CloseCost (если закрываем short и открываем short далее; знаки по сторонам учитываются формулами ниже).
- Для вертикалей применяется Width = |K_sell − K_buy|, BE и MaxLoss обновляются от новой пары.
- qty поддерживает десятые доли; все суммы масштабируются на qty.

### 12.3 Формулы (единичный контракт)
- Закрыть короткую ногу (short): CloseCost_short = mid(short_old) (buy to close → расход).
- Открыть короткую ногу (short): NewCredit_short = mid(short_new) (sell to open → кредит).
- NetCredit_leg = NewCredit_short − CloseCost_short.
- Полный ролл вертикали (закрыть обе ноги и открыть новую пару):
  - CloseCost_spread_old = mid(short_old) − mid(long_old)
  - NewCredit_spread_new = mid(short_new) − mid(long_new)
  - NetCredit_spread = NewCredit_spread_new − CloseCost_spread_old
- MaxLoss_new (vertical) = Width_new − NewCredit_spread_new
- BE_new:
  - PUT: BE_new = K_sell_new − NewCredit_spread_new
  - CALL: BE_new = K_sell_new + NewCredit_spread_new
- Итого по позиции: NetCredit_total = NetCredit (per) × qty; аналогично PnL/MaxLoss.

Примечание: накопленный исторический NetCredit влияет на итоговый PnL, но риск (MaxLoss) рассчитывается по текущему открытому вертикальному спреду.

### 12.4 Примеры (числа)
- Исходный PUT вертикал: K_sell=2700, K_buy=2600, Width=100, C_enter=1.20, qty=1.
  - Текущий mid старого спреда ≈ 0.70 → CloseCost_spread_old=0.70.
  - Roll out: та же пара страйков на более дальнюю экспирацию, mid нового ≈ 1.30 → NewCredit_spread_new=1.30.
  - NetCredit_spread = 1.30 − 0.70 = +0.60 (кредит).
  - MaxLoss_new = 100 − 1.30 = 98.70; BE_new = 2700 − 1.30 = 2698.7.
  - Δshort новой короткой ноги желательно 0.15–0.30.

- Roll down (PUT): перенос страйков ниже (например, 2600/2500), mid нового ≈ 0.90.
  - NetCredit_spread = 0.90 − 0.70 = +0.20; Width_new=100 → MaxLoss_new=99.10; BE_new сдвигается ниже (лучше для бычьей позы).

- Roll down & out: совместите оба шага; проверьте NetCredit ≥ 0 и приемлемую MaxLoss.

### 12.5 UI-поток в приложении
1) Откройте Edit позиции (multi-leg) → Roll helper.
2) Выберите ногу для ролла → целевую экспирацию → новый страйк (Option). Нажмите Add roll.
   - Будут добавлены две ноги: закрывающая старую (противоположная сторона) и открывающая новую (та же сторона), обе с entry по текущему mid.
3) Для полных роллов вертикали повторите для второй ноги (или сохраните как новую пару вместо двух одиночных роллов).
4) Сохраните позицию; убедитесь, что qty совпадает по парным ногам.
5) Просмотрите результат в My Positions: Net entry/mid/PnL, греки; для вертикалей доступны Width/MaxLoss/BE.

### 12.6 Чек-лист перед подтверждением ролла
- Δ короткой ноги: целевой диапазон 0.15–0.30.
- Ликвидность: узкий bid-ask, достаточный OI.
- NetCredit ≥ 0 (желательно) и MaxLoss_new приемлем.
- DTE новой экспирации ≥ 14 дней (ориентир для кредитных стратегий).
- Проверьте комиссию/проскальзывание; при необходимости добавьте буфер к лимит-цене.

### 12.7 Замечания и риски
- Низкая ликвидность/широкий спред → возможен проскальзывание; используйте лимиты.
- Высокая волатильность → резкие сдвиги Δ/цены; автообновления в UI помогают оценить момент входа.
- Частичные роллы (fractional qty) поддерживаются; следите за согласованностью qty между ногами.

### 12.8 ASCII-эскизы payoff (вертикали)

Bull PUT credit (short K_sell, long K_buy; K_sell > K_buy):

```
PnL ($)
  ^                ┌──────────────  +C (max profit)
  |               /|
  |              / |
  |             /  |
  |            /   |
  |___________/____|______________________________>  Price (S)
             K_buy  BE        K_sell

BE = K_sell − C; at S ≤ K_buy → −MaxLoss; at S ≥ K_sell → +C
```

Bear CALL credit (short K_sell, long K_buy; K_buy > K_sell):

```
PnL ($)
  ^   +C (max profit)  ────────────┐
  |                                |\
  |                                | \
  |                                |  \
  |                                |   \
  |________________________________|____\______________>  Price (S)
                                 K_buy  BE    K_sell

BE = K_sell + C; at S ≤ K_buy → +C; at S ≥ K_sell → −MaxLoss
```

### 12.9 Эскизы роллов (до/после)

Roll out (та же пара страйков, дальняя дата):

```
Before (near exp):           After (farther exp):

  −MaxL ──┐                    −MaxL ──┐
          │                           │
          └───/────── +C              └────/────── +C (чаще выше из-за больше времени)
              ^  ^                         ^  ^
             Kb  Ks                       Kb  Ks
```

Roll down (PUT): перенос страйков ниже (улучшение BE):

```
Before:                     After (lower strikes):

        /────── +C                 /────── +C
  _____/                          _/_____
      ^  ^ BE                        ^  ^ BE′ (ниже)
     Kb  Ks                         Kb′ Ks′
```

Roll down & out: совместите оба — ниже и дальше по времени; проверьте NetCredit ≥ 0.

---

## 14) Edge cases
- Missing quotes on a leg → highlight row, skip Mid_now/PnL calc, suggest another pair.
- Vol/price outlier tick → median smoothing over last 3–5 ticks before status.
- Uneven leg liquidity → warn about slippage (based on bid-ask and depth).

---

## 15) Roadmap (post-MVP)
- **IV Percentile / IV Rank** (ATM IV history)
- **Put/Call skew** (delta-neutral slices)
- **Private portfolio greeks** (with key) and margin
- **CSV export** for History; report screenshots
- **PnL profile** to expiration (what-if)
- **Roll wizard**

---

## 16) Open questions
- Is a backtest “emulator” mode with historical data needed, or are live feeds enough?
- Do we need Telegram/Email alerts (hard locally; webhook in v2)?
- Preferred backend stack (Node vs Python)?

---

## Project Proposals — 2025-09-15 (EN)

### Strengths
- Clear domain focus: local SPA for ETH options (Bybit) with a clean data model (verticals and multi‑leg) and local persistence.
- Solid frontend architecture: React + TypeScript + Vite, Zustand with persist; clean layering (services/store/components/utils) and Vite dev proxy.
- Rich features: Market (Spot/ATM IV/HV30/DTE), creating verticals and arbitrary multi‑leg positions, Δ/OI/spread filters, perp legs; unified positions table (PnL/greeks, liquidity badge, favorites, sorting, CSV export); unified View modal with payoff/T+0, anchoring to actual PnL, time slider, IV and r controls, mouse zoom, per‑position persistence.
- Resilient data pipeline: careful WS/REST merge without clobbering valid values; multi‑path IV derivation (markIv → from markPrice → bid/ask → mid → HV30).
- Strong internals: BS pricing utilities (price/IV), strategy detector, liquidity and Δσ metrics, correct PnL/extrema math.
- Good docs: README, PRD, and a build plan with recorded updates.

### Weaknesses
- No tests or CI linting: missing unit tests for bs/iv/strategy detector; no ESLint/Prettier or automated checks.
- Large components and duplicated compute logic (IV, dSigma, PnL) across table and modal; should extract to `utils`/hooks for reuse and testability.
- Scalability/performance: many WS subscriptions plus periodic REST polling; no table virtualization; potential extra re‑renders.
- Portfolio aggregates are partial: `PortfolioSummary` computes MaxLoss only for verticals, while the main table mixes vertical and multi‑leg — totals can be misleading.
- Error/UX handling: WS/REST failures are often silent; few skeletons and explicit connection/status indicators.
- Bybit response typing is loose in places (any/maps); strengthen types and normalization.
- Basic styling (inline styles) will hinder future theming/adaptive work.

### Development Outlook
- Short term (1–2 sprints)
  - Extract PnL/IV/Δσ/liq/extrema/BE to `utils` and add unit tests; unify usage between table and modal.
  - Align portfolio aggregates to a single model (support multi‑leg; annotate unbounded profit/loss).
  - Optimize subscriptions/state updates: symbol dedup, batched merges, memoization; consider React Query for REST caching.
  - Improve error/loading UX: skeletons and visible statuses (WS/REST/Disconnected/Retry).
- Mid term
  - Trade/close history, export/import with versioning; IndexedDB for larger local datasets.
  - Table virtualization and render profiling; split large components, lazy chunks.
  - IF rules/alerts running in background: local notifications, leg/position highlighting; presets.
  - Broaden scope: support other underlyings (e.g., BTC), base selection, localization.
- Long term
  - What‑if/stress testing (IV/Spot shifts), roll recommendations.
  - Optional backend: server cache for market data/aggregations, multi‑device sync and sharing, while keeping offline mode.
