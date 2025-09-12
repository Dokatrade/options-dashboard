# PRD — ETH Options Position Dashboard (MVP+)

## 1) Summary
Single-page local web app to monitor and manage ETH options on Bybit. Supports PUT/CALL vertical credit spreads and multi-leg positions (e.g., calendars). Shows market context, live quotes/greeks (WS), unified positions with PnL/greeks/liquidity, payoff for verticals, portfolio aggregates. Public Bybit REST/WS only; user provides entry and qty; local persistence.

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
