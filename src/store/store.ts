import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SpreadPosition, PortfolioSettings, Position } from '../utils/types';
import { ensureUsdtSymbol } from '../utils/symbols';

type State = {
  spreads: SpreadPosition[];
  positions: Position[];
  settings: PortfolioSettings;
  addSpread: (s: Omit<SpreadPosition, 'id' | 'createdAt' | 'closedAt'>) => void;
  addPosition: (p: Omit<Position, 'id' | 'createdAt' | 'closedAt'>) => void;
  markClosed: (id: string) => void;
  closePosition: (id: string) => void;
  remove: (id: string) => void;
  removePosition: (id: string) => void;
  updateSpread: (id: string, updater: (s: SpreadPosition) => SpreadPosition) => void;
  updatePosition: (id: string, updater: (p: Position) => Position) => void;
  setDeposit: (v: number) => void;
  importState: (data: { spreads?: any[]; positions?: any[]; settings?: Partial<PortfolioSettings> }) => { ok: boolean; error?: string };
  toggleFavoriteSpread: (id: string) => void;
  toggleFavoritePosition: (id: string) => void;
  setSpreadSettlement: (id: string, expiryMs: number, settleUnderlying?: number) => void;
  setPositionSettlement: (id: string, expiryMs: number, settleUnderlying?: number) => void;
};

function normalizeLegSymbol<T extends { symbol: string }>(leg: T): T {
  return { ...leg, symbol: ensureUsdtSymbol(leg.symbol) };
}

function normalizeSettlementsMap(raw: any) {
  if (!raw || typeof raw !== 'object') return undefined;
  const entries = Object.entries(raw).map(([key, value]) => {
    const settleUnderlying = Number((value as any)?.settleUnderlying);
    const settledAt = Number((value as any)?.settledAt);
    if (!(Number.isFinite(settleUnderlying) && settleUnderlying > 0)) return null;
    return [String(key), {
      settleUnderlying,
      settledAt: Number.isFinite(settledAt) ? settledAt : Date.now(),
    }] as const;
  }).filter(Boolean) as Array<[string, { settleUnderlying: number; settledAt: number }]>;
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      spreads: [],
      positions: [],
      settings: { depositUsd: 5000 },
      addSpread: (s) => set((st) => ({
        spreads: [
          {
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            ...s
          },
          ...st.spreads
        ]
      })),
      addPosition: (p) => set((st) => {
        const baseCreatedRaw = Number((p as any)?.createdAt);
        const baseCreatedAt = Number.isFinite(baseCreatedRaw) ? baseCreatedRaw : Date.now();
        let legOffset = 0;
        const legs = (p.legs ?? []).map((leg) => {
          const legCreatedAtRaw = Number((leg as any)?.createdAt);
          const createdAt = Number.isFinite(legCreatedAtRaw) ? legCreatedAtRaw : (baseCreatedAt + legOffset++);
          return { ...leg, createdAt };
        });
        const legsTimes = legs
          .map((leg) => Number(leg.createdAt))
          .filter((v): v is number => Number.isFinite(v));
        const createdAt = legsTimes.length ? Math.min(...legsTimes) : baseCreatedAt;
        return {
          positions: [
            {
              id: crypto.randomUUID(),
              createdAt,
              ...p,
              legs,
            },
            ...st.positions
          ]
        };
      }),
      markClosed: (id) => set((st) => ({
        spreads: st.spreads.map((p) => (p.id === id ? { ...p, closedAt: Date.now() } : p))
      })),
      closePosition: (id) => set((st) => ({
        positions: st.positions.map((p) => (p.id === id ? { ...p, closedAt: Date.now() } : p))
      })),
      remove: (id) => set((st) => ({ spreads: st.spreads.filter((p) => p.id !== id) })),
      removePosition: (id) => set((st) => ({ positions: st.positions.filter((p) => p.id !== id) })),
      updateSpread: (id, updater) => set((st) => ({ spreads: st.spreads.map((p) => (p.id === id ? updater(p) : p)) })),
      updatePosition: (id, updater) => set((st) => ({
        positions: st.positions.map((p) => {
          if (p.id !== id) return p;
          const updated = updater(p);
          if (!updated) return p;
          const now = Date.now();
          const baseCreatedRaw = Number((updated as any)?.createdAt);
          const baseCreatedAt = Number.isFinite(baseCreatedRaw) ? baseCreatedRaw : now;
          let legOffset = 0;
          const legs = (updated.legs ?? []).map((leg) => {
            const legCreatedAtRaw = Number((leg as any)?.createdAt);
            const createdAt = Number.isFinite(legCreatedAtRaw) ? legCreatedAtRaw : (baseCreatedAt + legOffset++);
            return { ...leg, createdAt };
          });
          const legsTimes = legs
            .map((leg) => Number(leg.createdAt))
            .filter((v): v is number => Number.isFinite(v));
          const createdAt = legsTimes.length ? Math.min(...legsTimes) : baseCreatedAt;
          return { ...updated, createdAt, legs };
        })
      })),
      setDeposit: (v) => set((st) => ({ settings: { ...st.settings, depositUsd: v } })),
      toggleFavoriteSpread: (id) => set((st) => ({ spreads: st.spreads.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)) })),
      toggleFavoritePosition: (id) => set((st) => ({ positions: st.positions.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)) })),
      setSpreadSettlement: (id, expiryMs, settleUnderlying) => set((st) => ({
        spreads: st.spreads.map((p) => {
          if (p.id !== id) return p;
          const key = String(expiryMs);
          const existing = p.settlements ?? {};
          if (!(settleUnderlying != null && Number.isFinite(settleUnderlying) && settleUnderlying > 0)) {
            if (!existing[key]) return p;
            const { [key]: _removed, ...rest } = existing;
            const next = Object.keys(rest).length ? rest : undefined;
            return { ...p, settlements: next };
          }
          return {
            ...p,
            settlements: {
              ...existing,
              [key]: { settleUnderlying, settledAt: Date.now() }
            }
          };
        })
      })),
      setPositionSettlement: (id, expiryMs, settleUnderlying) => set((st) => ({
        positions: st.positions.map((p) => {
          if (p.id !== id) return p;
          const key = String(expiryMs);
          const existing = p.settlements ?? {};
          if (!(settleUnderlying != null && Number.isFinite(settleUnderlying) && settleUnderlying > 0)) {
            if (!existing[key]) return p;
            const { [key]: _removed, ...rest } = existing;
            const next = Object.keys(rest).length ? rest : undefined;
            return { ...p, settlements: next };
          }
          return {
            ...p,
            settlements: {
              ...existing,
              [key]: { settleUnderlying, settledAt: Date.now() }
            }
          };
        })
      })),
      importState: (data) => {
        try {
          const spreadsIn = Array.isArray(data?.spreads) ? data!.spreads : [];
          const positionsIn = Array.isArray(data?.positions) ? data!.positions : [];
          const settingsIn = data?.settings ?? {};
          const normSpreads: SpreadPosition[] = spreadsIn.map((p: any) => {
            const id = typeof p?.id === 'string' ? p.id : (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
            const createdAt = Number(p?.createdAt) || Date.now();
            const closedAt = p?.closedAt != null ? Number(p.closedAt) : undefined;
            const cEnter = Number(p?.cEnter) || 0;
            const qty = Number(p?.qty) > 0 ? Number(p.qty) : 1;
            const entryShort = p?.entryShort != null ? Number(p.entryShort) : undefined;
            const entryLong = p?.entryLong != null ? Number(p.entryLong) : undefined;
            const short = p?.short ?? {};
            const long = p?.long ?? {};
            return {
              id,
              createdAt,
              closedAt,
              cEnter,
              entryShort,
              entryLong,
              qty,
              note: typeof p?.note === 'string' ? p.note : undefined,
              favorite: typeof p?.favorite === 'boolean' ? p.favorite : undefined,
              settlements: normalizeSettlementsMap(p?.settlements),
              short: normalizeLegSymbol({
                symbol: String(short?.symbol || ''),
                strike: Number(short?.strike) || 0,
                optionType: short?.optionType === 'P' ? 'P' : 'C',
                expiryMs: Number(short?.expiryMs) || 0,
              }),
              long: normalizeLegSymbol({
                symbol: String(long?.symbol || ''),
                strike: Number(long?.strike) || 0,
                optionType: long?.optionType === 'P' ? 'P' : 'C',
                expiryMs: Number(long?.expiryMs) || 0,
              }),
            } as SpreadPosition;
          }).filter((p) => p.short.symbol && p.long.symbol && p.cEnter >= 0);

          const normPositions: Position[] = positionsIn.map((p: any) => {
            const id = typeof p?.id === 'string' ? p.id : (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
            const createdAt = Number(p?.createdAt) || Date.now();
            const closedAt = p?.closedAt != null ? Number(p.closedAt) : undefined;
            const note = typeof p?.note === 'string' ? p.note : undefined;
            let legCounter = 0;
            const legs = Array.isArray(p?.legs) ? p.legs.map((l: any) => {
              const legCreatedAtRaw = Number(l?.createdAt);
              const legCreatedAt = Number.isFinite(legCreatedAtRaw) ? legCreatedAtRaw : (createdAt + legCounter++);
              return {
                leg: normalizeLegSymbol({
                  symbol: String(l?.leg?.symbol || ''),
                  strike: Number(l?.leg?.strike) || 0,
                  optionType: l?.leg?.optionType === 'P' ? 'P' : 'C',
                  expiryMs: Number(l?.leg?.expiryMs) || 0,
                }),
                side: l?.side === 'long' ? 'long' : 'short',
                qty: Number(l?.qty) > 0 ? Number(l.qty) : 1,
                entryPrice: Number(l?.entryPrice) || 0,
                createdAt: legCreatedAt,
                hidden: typeof l?.hidden === 'boolean' ? l.hidden : undefined,
                settleS: (() => {
                  const raw = Number((l as any)?.settleS);
                  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
                })(),
                settledAt: (() => {
                  const raw = Number((l as any)?.settledAt);
                  return Number.isFinite(raw) ? raw : undefined;
                })(),
              };
            }).filter((l: any) => l.leg.symbol) : [];
            const legTimes = legs
              .map((leg: any) => Number(leg?.createdAt))
              .filter((v: number) => Number.isFinite(v));
            const posCreatedAt = legTimes.length ? Math.min(...legTimes) : createdAt;
            return {
              id,
              createdAt: posCreatedAt,
              closedAt,
              note,
              legs,
              favorite: typeof p?.favorite === 'boolean' ? p.favorite : undefined,
              settlements: normalizeSettlementsMap(p?.settlements),
            } as Position;
          }).filter((p) => p.legs.length > 0);

          set((st) => ({
            spreads: normSpreads,
            positions: normPositions,
            settings: {
              ...st.settings,
              ...(typeof settingsIn?.depositUsd === 'number' && settingsIn.depositUsd >= 0 ? { depositUsd: settingsIn.depositUsd } : {}),
            }
          }));
          return { ok: true };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'Invalid file' };
        }
      }
    }),
    {
      name: 'options-dashboard',
      version: 4,
      migrate: (state: any, version) => {
        if (!state) return state as State;
        let nextState = state;

        if (version < 2) {
          const normalizeLeg = (leg: any) => ({
            ...leg,
            symbol: ensureUsdtSymbol(leg?.symbol || ''),
          });
          const spreads = Array.isArray(nextState.spreads)
            ? nextState.spreads.map((s: any) => ({
                ...s,
                short: normalizeLeg(s?.short || {}),
                long: normalizeLeg(s?.long || {}),
              }))
            : nextState.spreads;
          const positions = Array.isArray(nextState.positions)
            ? nextState.positions.map((p: any) => ({
                ...p,
                legs: Array.isArray(p?.legs)
                  ? p.legs.map((l: any) => ({
                      ...l,
                      leg: normalizeLeg(l?.leg || {}),
                    }))
                  : p?.legs,
              }))
            : nextState.positions;
          nextState = { ...nextState, spreads, positions };
        }

        if (version < 3) {
          const spreads = Array.isArray(nextState.spreads)
            ? nextState.spreads.map((s: any) => ({
                ...s,
                settlements: normalizeSettlementsMap(s?.settlements),
              }))
            : nextState.spreads;
          const positions = Array.isArray(nextState.positions)
            ? nextState.positions.map((p: any) => ({
                ...p,
                settlements: normalizeSettlementsMap(p?.settlements),
              }))
            : nextState.positions;
          nextState = { ...nextState, spreads, positions };
        }

        if (version < 4) {
          const adjustPositions = Array.isArray(nextState.positions)
            ? nextState.positions.map((p: any) => {
                if (!Array.isArray(p?.legs)) return p;
                const legTimes = p.legs
                  .map((leg: any) => Number(leg?.createdAt))
                  .filter((v: number) => Number.isFinite(v));
                if (!legTimes.length) return p;
                const earliest = Math.min(...legTimes);
                if (Number(p?.createdAt) === earliest) return p;
                return { ...p, createdAt: earliest };
              })
            : nextState.positions;
          nextState = { ...nextState, positions: adjustPositions };
        }

        return nextState as State;
      }
    }
  )
);
