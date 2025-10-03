import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SpreadPosition, PortfolioSettings, Position, CloseSnapshot } from '../utils/types';
import { ensureUsdtSymbol } from '../utils/symbols';

export const DEFAULT_PORTFOLIO_ID = 'default';

type PortfolioMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

type State = {
  spreads: SpreadPosition[];
  positions: Position[];
  settings: PortfolioSettings;
  portfolios: PortfolioMeta[];
  activePortfolioId: string;
  addSpread: (s: Omit<SpreadPosition, 'id' | 'createdAt' | 'closedAt'>) => void;
  addPosition: (p: Omit<Position, 'id' | 'createdAt' | 'closedAt'>) => void;
  markClosed: (id: string, snapshot?: CloseSnapshot) => void;
  closePosition: (id: string, snapshot?: CloseSnapshot) => void;
  remove: (id: string) => void;
  removePosition: (id: string) => void;
  updateSpread: (id: string, updater: (s: SpreadPosition) => SpreadPosition) => void;
  updatePosition: (id: string, updater: (p: Position) => Position) => void;
  setDeposit: (v: number) => void;
  setRiskLimitPct: (v: number | undefined) => void;
  importState: (data: { spreads?: any[]; positions?: any[]; settings?: Partial<PortfolioSettings>; portfolios?: any[]; activePortfolioId?: string }) => { ok: boolean; error?: string };
  toggleFavoriteSpread: (id: string) => void;
  toggleFavoritePosition: (id: string) => void;
  setSpreadSettlement: (id: string, expiryMs: number, settleUnderlying?: number) => void;
  setPositionSettlement: (id: string, expiryMs: number, settleUnderlying?: number) => void;
  clearRealizedHistory: () => void;
  createPortfolio: (name: string) => string | null;
  setActivePortfolio: (id: string) => void;
  deletePortfolio: (id: string) => void;
  renamePortfolio: (id: string, name: string) => void;
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

function toNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function normalizeCloseSnapshot(raw: any, fallbackTimestamp: number): CloseSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const ts = toNumber((raw as any)?.timestamp ?? (raw as any)?.closedAt ?? (raw as any)?.time);
  const timestamp = ts ?? fallbackTimestamp;
  const indexPrice = toNumber((raw as any)?.indexPrice ?? (raw as any)?.index);
  const spotPrice = toNumber((raw as any)?.spotPrice ?? (raw as any)?.spot);
  const pnlExec = toNumber((raw as any)?.pnlExec ?? (raw as any)?.pnl);
  const snapshot: CloseSnapshot = { timestamp };
  if (indexPrice != null) snapshot.indexPrice = indexPrice;
  if (spotPrice != null) snapshot.spotPrice = spotPrice;
  if (pnlExec != null) snapshot.pnlExec = pnlExec;
  return snapshot;
}

function sanitizeSnapshot(snapshot?: CloseSnapshot): CloseSnapshot | undefined {
  if (!snapshot) return undefined;
  const timestamp = toNumber(snapshot.timestamp) ?? Date.now();
  const sanitized: CloseSnapshot = { timestamp };
  const indexPrice = toNumber(snapshot.indexPrice);
  if (indexPrice != null) sanitized.indexPrice = indexPrice;
  const spotPrice = toNumber(snapshot.spotPrice);
  if (spotPrice != null) sanitized.spotPrice = spotPrice;
  const pnlExec = toNumber(snapshot.pnlExec);
  if (pnlExec != null) sanitized.pnlExec = pnlExec;
  return sanitized;
}

const makePortfolioMeta = (id: string, name: string): PortfolioMeta => {
  const ts = Date.now();
  return { id, name: name.trim() || 'Portfolio', createdAt: ts, updatedAt: ts };
};

const ensurePortfolioExists = (portfolios: PortfolioMeta[], id: string): boolean => portfolios.some((p) => p.id === id);

const resolvePortfolioId = (candidate: string | undefined, state: Pick<State, 'activePortfolioId' | 'portfolios'>): string => {
  if (candidate && ensurePortfolioExists(state.portfolios, candidate)) return candidate;
  if (ensurePortfolioExists(state.portfolios, state.activePortfolioId)) return state.activePortfolioId;
  return DEFAULT_PORTFOLIO_ID;
};

const touchPortfolio = (portfolios: PortfolioMeta[], id: string): PortfolioMeta[] => {
  const ts = Date.now();
  return portfolios.map((p) => (p.id === id ? { ...p, updatedAt: ts } : p));
};

export const useStore = create<State>()(
  persist(
    (set, _get) => ({
      spreads: [],
      positions: [],
      settings: { depositUsd: 5000, riskLimitPct: undefined },
      portfolios: [makePortfolioMeta(DEFAULT_PORTFOLIO_ID, 'Default')],
      activePortfolioId: DEFAULT_PORTFOLIO_ID,
      addSpread: (s) => set((st) => {
        const portfolioId = resolvePortfolioId((s as any)?.portfolioId, st);
        const createdAt = Date.now();
        const spread: SpreadPosition = {
          id: crypto.randomUUID(),
          createdAt,
          ...s,
          portfolioId,
        };
        return {
          spreads: [spread, ...st.spreads],
          portfolios: touchPortfolio(st.portfolios, portfolioId),
        };
      }),
      addPosition: (p) => set((st) => {
        const portfolioId = resolvePortfolioId((p as any)?.portfolioId, st);
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
        const position: Position = {
          id: crypto.randomUUID(),
          createdAt,
          ...p,
          legs,
          portfolioId,
        };
        return {
          positions: [position, ...st.positions],
          portfolios: touchPortfolio(st.portfolios, portfolioId),
        };
      }),
      markClosed: (id, snapshot) => set((st) => {
        let targetPortfolio: string | null = null;
        const spreads = st.spreads.map((p) => {
          if (p.id !== id) return p;
          targetPortfolio = p.portfolioId ?? DEFAULT_PORTFOLIO_ID;
          const sanitized = sanitizeSnapshot(snapshot);
          if (sanitized) return { ...p, closedAt: sanitized.timestamp, closeSnapshot: sanitized };
          if (p.closedAt) return p;
          return { ...p, closedAt: Date.now() };
        });
        return {
          spreads,
          portfolios: targetPortfolio ? touchPortfolio(st.portfolios, targetPortfolio) : st.portfolios,
        };
      }),
      closePosition: (id, snapshot) => set((st) => {
        let targetPortfolio: string | null = null;
        const positions = st.positions.map((p) => {
          if (p.id !== id) return p;
          targetPortfolio = p.portfolioId ?? DEFAULT_PORTFOLIO_ID;
          const sanitized = sanitizeSnapshot(snapshot);
          if (sanitized) return { ...p, closedAt: sanitized.timestamp, closeSnapshot: sanitized };
          if (p.closedAt) return p;
          return { ...p, closedAt: Date.now() };
        });
        return {
          positions,
          portfolios: targetPortfolio ? touchPortfolio(st.portfolios, targetPortfolio) : st.portfolios,
        };
      }),
      remove: (id) => set((st) => {
        const target = st.spreads.find((p) => p.id === id);
        const spreads = st.spreads.filter((p) => p.id !== id);
        return {
          spreads,
          portfolios: target ? touchPortfolio(st.portfolios, target.portfolioId ?? DEFAULT_PORTFOLIO_ID) : st.portfolios,
        };
      }),
      removePosition: (id) => set((st) => {
        const target = st.positions.find((p) => p.id === id);
        const positions = st.positions.filter((p) => p.id !== id);
        return {
          positions,
          portfolios: target ? touchPortfolio(st.portfolios, target.portfolioId ?? DEFAULT_PORTFOLIO_ID) : st.portfolios,
        };
      }),
      updateSpread: (id, updater) => set((st) => {
        let touched: string | null = null;
        const spreads = st.spreads.map((p) => {
          if (p.id !== id) return p;
          const updated = updater(p);
          if (!updated) return p;
          const candidate = (updated as SpreadPosition)?.portfolioId ?? p.portfolioId;
          const portfolioId = resolvePortfolioId(candidate, st);
          touched = portfolioId;
          return { ...updated, portfolioId } as SpreadPosition;
        });
        return {
          spreads,
          portfolios: touched ? touchPortfolio(st.portfolios, touched) : st.portfolios,
        };
      }),
      updatePosition: (id, updater) => set((st) => {
        let touched: string | null = null;
        const positions = st.positions.map((p) => {
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
          const candidate = (updated as Position)?.portfolioId ?? p.portfolioId;
          const portfolioId = resolvePortfolioId(candidate, st);
          touched = portfolioId;
          return { ...updated, createdAt, legs, portfolioId } as Position;
        });
        return {
          positions,
          portfolios: touched ? touchPortfolio(st.portfolios, touched) : st.portfolios,
        };
      }),
      setDeposit: (v) => set((st) => ({ settings: { ...st.settings, depositUsd: v } })),
      setRiskLimitPct: (v) => set((st) => ({ settings: { ...st.settings, riskLimitPct: v != null && Number.isFinite(v) && v >= 0 ? Number(v) : undefined } })),
      toggleFavoriteSpread: (id) => set((st) => {
        let touched: string | null = null;
        const spreads = st.spreads.map((p) => {
          if (p.id !== id) return p;
          touched = p.portfolioId ?? DEFAULT_PORTFOLIO_ID;
          return { ...p, favorite: !p.favorite };
        });
        return {
          spreads,
          portfolios: touched ? touchPortfolio(st.portfolios, touched) : st.portfolios,
        };
      }),
      toggleFavoritePosition: (id) => set((st) => {
        let touched: string | null = null;
        const positions = st.positions.map((p) => {
          if (p.id !== id) return p;
          touched = p.portfolioId ?? DEFAULT_PORTFOLIO_ID;
          return { ...p, favorite: !p.favorite };
        });
        return {
          positions,
          portfolios: touched ? touchPortfolio(st.portfolios, touched) : st.portfolios,
        };
      }),
      setSpreadSettlement: (id, expiryMs, settleUnderlying) => set((st) => {
        let touched: string | null = null;
        const spreads = st.spreads.map((p) => {
          if (p.id !== id) return p;
          touched = p.portfolioId ?? DEFAULT_PORTFOLIO_ID;
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
        });
        return {
          spreads,
          portfolios: touched ? touchPortfolio(st.portfolios, touched) : st.portfolios,
        };
      }),
      setPositionSettlement: (id, expiryMs, settleUnderlying) => set((st) => {
        let touched: string | null = null;
        const positions = st.positions.map((p) => {
          if (p.id !== id) return p;
          touched = p.portfolioId ?? DEFAULT_PORTFOLIO_ID;
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
        });
        return {
          positions,
          portfolios: touched ? touchPortfolio(st.portfolios, touched) : st.portfolios,
        };
      }),
      clearRealizedHistory: () => set((st) => ({
        spreads: st.spreads.map((p) => ({ ...p, closeSnapshot: undefined })),
        positions: st.positions.map((p) => ({ ...p, closeSnapshot: undefined })),
        portfolios: st.portfolios.map((meta) => ({ ...meta, updatedAt: Date.now() })),
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
            const closeSnapshot = normalizeCloseSnapshot(p?.closeSnapshot, closedAt ?? createdAt);
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
              closeSnapshot,
              cEnter,
              entryShort,
              entryLong,
              qty,
              note: typeof p?.note === 'string' ? p.note : undefined,
              favorite: typeof p?.favorite === 'boolean' ? p.favorite : undefined,
              settlements: normalizeSettlementsMap(p?.settlements),
              portfolioId: typeof p?.portfolioId === 'string' ? p.portfolioId : undefined,
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
            const closeSnapshot = normalizeCloseSnapshot(p?.closeSnapshot, closedAt ?? posCreatedAt);
            return {
              id,
              createdAt: posCreatedAt,
              closedAt,
              closeSnapshot,
              note,
              legs,
              favorite: typeof p?.favorite === 'boolean' ? p.favorite : undefined,
              settlements: normalizeSettlementsMap(p?.settlements),
              portfolioId: typeof p?.portfolioId === 'string' ? p.portfolioId : undefined,
            } as Position;
          }).filter((p) => p.legs.length > 0);

          const rawPortfolios = Array.isArray((data as any)?.portfolios) ? (data as any).portfolios : [];
          const portfolioMap = new Map<string, PortfolioMeta>();
          for (const meta of rawPortfolios) {
            const rawId = typeof meta?.id === 'string' ? meta.id.trim() : '';
            if (!rawId) continue;
            const name = String(meta?.name ?? '').trim() || 'Portfolio';
            const createdAt = Number(meta?.createdAt);
            const updatedAt = Number(meta?.updatedAt);
            portfolioMap.set(rawId, {
              id: rawId,
              name,
              createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
              updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
            });
          }
          if (!portfolioMap.has(DEFAULT_PORTFOLIO_ID)) {
            const meta = makePortfolioMeta(DEFAULT_PORTFOLIO_ID, 'Default');
            portfolioMap.set(DEFAULT_PORTFOLIO_ID, meta);
          }
          const portfoliosList = Array.from(portfolioMap.values()).sort((a, b) => {
            if (a.id === DEFAULT_PORTFOLIO_ID) return -1;
            if (b.id === DEFAULT_PORTFOLIO_ID) return 1;
            return a.createdAt - b.createdAt;
          });
          const validIds = new Set(portfoliosList.map((p) => p.id));
          const ensurePortfolioIdForImport = (candidate?: string): string => (
            candidate && validIds.has(candidate) ? candidate : DEFAULT_PORTFOLIO_ID
          );
          const spreadsWithPortfolio = normSpreads.map((s) => ({
            ...s,
            portfolioId: ensurePortfolioIdForImport(s.portfolioId),
          }));
          const positionsWithPortfolio = normPositions.map((p) => ({
            ...p,
            portfolioId: ensurePortfolioIdForImport(p.portfolioId),
          }));
          const incomingActive = typeof (data as any)?.activePortfolioId === 'string' ? (data as any).activePortfolioId : DEFAULT_PORTFOLIO_ID;
          const activePortfolioId = ensurePortfolioIdForImport(incomingActive);

          set((st) => ({
            spreads: spreadsWithPortfolio,
            positions: positionsWithPortfolio,
            settings: {
              ...st.settings,
              ...(typeof settingsIn?.depositUsd === 'number' && settingsIn.depositUsd >= 0 ? { depositUsd: settingsIn.depositUsd } : {}),
              ...(typeof settingsIn?.riskLimitPct === 'number' && settingsIn.riskLimitPct >= 0 ? { riskLimitPct: settingsIn.riskLimitPct } : {}),
            },
            portfolios: portfoliosList,
            activePortfolioId,
          }));
          return { ok: true };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'Invalid file' };
        }
      },
      createPortfolio: (name) => {
        const trimmed = (name ?? '').trim();
        if (!trimmed) return null;
        const id = crypto.randomUUID();
        set((st) => {
          if (ensurePortfolioExists(st.portfolios, id)) return {};
          const meta = { ...makePortfolioMeta(id, trimmed), name: trimmed };
          return {
            portfolios: [...st.portfolios, meta],
            activePortfolioId: id,
          };
        });
        return id;
      },
      setActivePortfolio: (id) => set((st) => {
        if (!ensurePortfolioExists(st.portfolios, id)) return {};
        if (st.activePortfolioId === id) return {};
        return { activePortfolioId: id };
      }),
      deletePortfolio: (id) => set((st) => {
        if (id === DEFAULT_PORTFOLIO_ID) return {};
        if (!ensurePortfolioExists(st.portfolios, id)) return {};
        const fallback = st.activePortfolioId === id ? DEFAULT_PORTFOLIO_ID : st.activePortfolioId;
        const spreads = st.spreads.map((spread) => spread.portfolioId === id ? { ...spread, portfolioId: DEFAULT_PORTFOLIO_ID } : spread);
        const positions = st.positions.map((position) => position.portfolioId === id ? { ...position, portfolioId: DEFAULT_PORTFOLIO_ID } : position);
        const portfolios = st.portfolios
          .filter((meta) => meta.id !== id)
          .map((meta) => meta.id === DEFAULT_PORTFOLIO_ID ? { ...meta, updatedAt: Date.now() } : meta);
        const sorted = portfolios.sort((a, b) => {
          if (a.id === DEFAULT_PORTFOLIO_ID) return -1;
          if (b.id === DEFAULT_PORTFOLIO_ID) return 1;
          return a.createdAt - b.createdAt;
        });
        return {
          spreads,
          positions,
          portfolios: sorted,
          activePortfolioId: fallback,
        };
      }),
      renamePortfolio: (id, name) => set((st) => {
        if (id === DEFAULT_PORTFOLIO_ID) return {};
        const trimmed = (name ?? '').trim();
        if (!trimmed) return {};
        if (!ensurePortfolioExists(st.portfolios, id)) return {};
        if (st.portfolios.some((p) => p.id !== id && p.name.trim().toLowerCase() === trimmed.toLowerCase())) return {};
        const portfolios = st.portfolios.map((meta) => meta.id === id ? { ...meta, name: trimmed, updatedAt: Date.now() } : meta);
        return { portfolios };
      })
    }),
    {
      name: 'options-dashboard',
      version: 5,
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

        if (version < 5) {
          const spreads = Array.isArray(nextState.spreads)
            ? nextState.spreads.map((s: any) => ({
                ...s,
                portfolioId: typeof s?.portfolioId === 'string' ? s.portfolioId : DEFAULT_PORTFOLIO_ID,
              }))
            : [];
          const positions = Array.isArray(nextState.positions)
            ? nextState.positions.map((p: any) => ({
                ...p,
                portfolioId: typeof p?.portfolioId === 'string' ? p.portfolioId : DEFAULT_PORTFOLIO_ID,
              }))
            : [];
          let portfolios = Array.isArray(nextState.portfolios)
            ? nextState.portfolios
                .filter((meta: any) => typeof meta?.id === 'string' && meta.id)
                .map((meta: any) => ({
                  id: String(meta.id),
                  name: String((meta.name ?? '').trim() || 'Portfolio'),
                  createdAt: Number(meta?.createdAt) || Date.now(),
                  updatedAt: Number(meta?.updatedAt) || Date.now(),
                }))
            : [];
          if (!ensurePortfolioExists(portfolios, DEFAULT_PORTFOLIO_ID)) {
            const defaultMeta = makePortfolioMeta(DEFAULT_PORTFOLIO_ID, 'Default');
            portfolios = [defaultMeta, ...portfolios.filter((p: PortfolioMeta) => p.id !== DEFAULT_PORTFOLIO_ID)];
          }
          const activePortfolioId = typeof nextState.activePortfolioId === 'string' && ensurePortfolioExists(portfolios, nextState.activePortfolioId)
            ? nextState.activePortfolioId
            : DEFAULT_PORTFOLIO_ID;
          nextState = { ...nextState, spreads, positions, portfolios, activePortfolioId };
        }

        return nextState as State;
      }
    }
  )
);
