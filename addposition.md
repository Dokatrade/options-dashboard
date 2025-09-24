# Add Position Variant 1 — PRD & Implementation Plan

## 1. Background
- Current `AddPosition` card (src/components/AddPosition.tsx) combines filters, option selection, and leg drafting inside one dense grid, making discovery and workflows slow.
- Traders need a clear separation between contract discovery (filters + option chain) and position construction.

## 2. Problem Statement
How might we redesign the **Add Position** builder so that users can quickly filter the option chain, compare strikes, and add legs without cognitive overload?

## 3. Goals & Success Metrics
- **G1 – Reduce friction**: Users can locate an option and add a leg in ≤ 3 interactions.
- **G2 – Improve readability**: Option chain presents greeks/liq metrics in a scan-friendly layout.
- **G3 – Clarify state**: Draft area clearly reflects selected legs and net credit/debit in real-time.
- **Metrics** (post-ship observational):
  - Avg. time from filter change → leg added < 10s (internal testing).
  - QA checklist: zero confusion reports (manual feedback) in staging review.

## 4. In-Scope
- Refactor `AddPosition` UI into two stacked zones within one card:
  1. **Filters & Context**
  2. **Option Chain + Quick Actions**
- Replace strike `<select>` with table-based option chain supporting sorting/selection.
- Update draft section with color coding + improved affordances.
- Maintain existing business logic (data fetching, draft persistence).

## 5. Out-of-Scope / Non-Goals
- No backend/API changes beyond UI-driven fetch cadence adjustments.
- No new option analytics; reuse existing greeks and orderbook data.
- No changes to `addSpread` / `addPosition` store behavior.

## 6. User Personas & Stories
- **Options trader (advanced)**: Filters for Δ 0.20-0.30, compares OI/spread, adds short vertical quickly.
- **Portfolio manager (intermediate)**: Adds hedge leg while monitoring mid prices and PERP alternatives.

**Stories**
1. *As a trader, I want to filter the chain and click a strike row to preview pricing before adding a leg.*
2. *As a trader, I want clear buttons to add short/long or PERP legs without scrolling.*
3. *As a trader, I want the draft table to highlight current P/L orientation (credit/debit) instantly.*

## 7. UX Breakdown (Variant 1)
- **Card header**: `Add Position` + optional `Slow mode` badge if enabled.
- **Filters row (left column, 2 rows)**
  - Row 1: `Type` segmented control, `Expiry` select, `Show all strikes` toggle.
  - Row 2: `Δ range` dual input, `Min OI`, `Max spread`.
- **Spot price chip**: Show current ETHUSDT mark for context.
- **Option chain table** (right side, responsive):
  - Columns: Strike, Bid, Ask, Mid, Δ, OI, Spread (derived), Expiry (if multiple), Liquidity badge.
  - Row hover + click selects strike. Selection states mirror `filteredChain`.
  - Top toolbar: display count, quick filter badges (e.g., “Δ 0.15-0.30”).
- **Selection panel / Quick actions** (beside or below chain depending on width):
  - Shows selected contract summary with live prices.
  - Buttons: `Add Short`, `Add Long`, `Add Perp Short`, `Add Perp Long`, `Qty` input.
  - “Clear selection” link resets strike.
- **Draft builder section** (bottom full-width):
  - Table with columns: Type/Asset badge, Expiry, Strike, Side, Qty (editable inline), Mid now, Remove.
  - Net credit/debit chip colored (green for credit ≥0, red for debit <0).
  - Save button (primary). Secondary ghost button `Save as Vertical` appears when `canSaveAsVertical` true.
  - Helper text for unsupported save combos aligned with button row.

## 8. States & Empty Cases
- Loading: skeleton rows for chain, disabled quick-action buttons.
- No results: copy “No strikes match filters. Adjust Δ range or toggle ‘Show all strikes’.”
- Slow mode: rate-limit live updates; show tooltip indicating refresh cadence.
- Desktop ≥ 1024px: filters left column (approx 30%), chain right (70%). Tablet/mobile: filters stack on top, chain full width, action panel collapses into drawer below chain.

## 9. Technical Requirements
- Reuse `filteredChain` but expose via memoized data structure with computed fields (mid, spread, badges).
- Introduce local state `selectedSymbol` to track currently highlighted row.
- Convert select → table: use semantic `<table>` with sticky header; maintain `overflow-x: auto` for narrow view.
- Ensure accessibility: keyboard navigation on chain (arrow keys, enter to select).
- Preserve localStorage draft schema; extend to remember last `selectedSymbol` optional.
- Keep WebSocket subscriptions optimized (no additional load beyond existing `chain` usage).

## 10. Edge Cases & Risks
- Large chain length: ensure virtualization not required yet (Bybit ETH chains manageable). Monitor performance.
- Slow network: fallback to REST tickers should populate table gradually; need loading placeholders.
- Mobile layout: check scrollable areas don’t conflict with table stickiness.
- Maintaining compatibility with `showAllStrikes` toggle ensures union from tickers stays visible.

## 11. Dependencies
- Existing services (`fetchOptionTickers`, WS) remain intact.
- No third-party UI libs introduced.

## 12. QA Checklist
- Filters update chain rows instantly.
- Selecting row updates selection panel and enables add buttons.
- Adding PERP leg persists and shows `PERP` badge in draft.
- Clearing draft wipes localStorage entry.
- Save vertical still adds spread to store with correct pricing.
- Keyboard nav (tab + arrow) on table works.

---

# Implementation Plan

## Phase 0 — Preparation
1. Snapshot current component behavior (screenshots or notes).
2. Add todo markers for sections that will be extracted (`// TODO: refactor into subcomponents`).

## Phase 1 — Component Refactor
- Create subcomponents in `src/components/add-position/`:
  - `FiltersPanel.tsx`
  - `OptionChainTable.tsx`
  - `SelectionPanel.tsx`
  - `DraftTable.tsx`
- Move shared types/utilities to `AddPosition.types.ts` if necessary.
- Ensure props expose existing handlers/states without breaking store access.

## Phase 2 — UI Restructure
- Replace grid layout with flex-based two-column layout using existing CSS tokens.
- Implement table rendering using `filteredChain` data. Add helper for `formatChainRow` (strike formatting, badges).
- Introduce `selectedSymbol` state, highlight row via `aria-selected` + CSS.
- Build selection panel with `Qty` input + action buttons grouped.

## Phase 3 — Styling & Responsiveness
- Extend global stylesheet (index.html) with minimal classes for layout (`.add-position`, `.chain-table`, `.selection-panel`).
- Add conditional layout logic (media queries) to stack columns below 900px.
- Apply color chips for credit/debit using existing CSS vars (`--gain`, `--loss`).

## Phase 4 — Logic Updates & Persistence
- Hook table row click to set `strike` and `selectedSymbol` (sync with existing state).
- Ensure `addLeg` / `addPerpLeg` consume `selectedSymbol` or existing `strike` states.
- Update localStorage payload (optional field `selectedSymbol`), maintain backward compatibility when reading old drafts.
- Add keyboard handlers for table navigation (up/down to change selection).

## Phase 5 — Polish & Testing
- Manual QA checklist from Section 12.
- Verify slow mode behavior (no continuous WS flood).
- Check ESLint/TypeScript after refactor.
- Optional: add Jest/Vitest component tests for selection logic (if testing infra exists).

## Phase 6 — Documentation & Rollout
- Update README/plan with new UI screenshot.
- Prepare changelog snippet for release.
- Flag for regression testing focusing on position saving flows.

## Estimated Effort
- Design polish & layout scaffolding: ~1 day.
- Component extraction + logic wiring: ~1.5 days.
- Testing & fixes: ~0.5 day.
- Total: ~3 days (single engineer).
