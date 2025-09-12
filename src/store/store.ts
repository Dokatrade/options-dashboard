import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SpreadPosition, PortfolioSettings, Leg, Position } from '../utils/types';

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
  updatePosition: (id: string, updater: (p: Position) => Position) => void;
  setDeposit: (v: number) => void;
  importState: (data: { spreads?: any[]; positions?: any[]; settings?: Partial<PortfolioSettings> }) => { ok: boolean; error?: string };
  toggleFavoriteSpread: (id: string) => void;
  toggleFavoritePosition: (id: string) => void;
};

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
      addPosition: (p) => set((st) => ({
        positions: [
          {
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            ...p
          },
          ...st.positions
        ]
      })),
      markClosed: (id) => set((st) => ({
        spreads: st.spreads.map((p) => (p.id === id ? { ...p, closedAt: Date.now() } : p))
      })),
      closePosition: (id) => set((st) => ({
        positions: st.positions.map((p) => (p.id === id ? { ...p, closedAt: Date.now() } : p))
      })),
      remove: (id) => set((st) => ({ spreads: st.spreads.filter((p) => p.id !== id) })),
      removePosition: (id) => set((st) => ({ positions: st.positions.filter((p) => p.id !== id) })),
      updatePosition: (id, updater) => set((st) => ({ positions: st.positions.map((p) => (p.id === id ? updater(p) : p)) })),
      setDeposit: (v) => set((st) => ({ settings: { ...st.settings, depositUsd: v } })),
      toggleFavoriteSpread: (id) => set((st) => ({ spreads: st.spreads.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)) })),
      toggleFavoritePosition: (id) => set((st) => ({ positions: st.positions.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)) })),
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
              short: {
                symbol: String(short?.symbol || ''),
                strike: Number(short?.strike) || 0,
                optionType: short?.optionType === 'P' ? 'P' : 'C',
                expiryMs: Number(short?.expiryMs) || 0,
              },
              long: {
                symbol: String(long?.symbol || ''),
                strike: Number(long?.strike) || 0,
                optionType: long?.optionType === 'P' ? 'P' : 'C',
                expiryMs: Number(long?.expiryMs) || 0,
              },
            } as SpreadPosition;
          }).filter((p) => p.short.symbol && p.long.symbol && p.cEnter >= 0);

          const normPositions: Position[] = positionsIn.map((p: any) => {
            const id = typeof p?.id === 'string' ? p.id : (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
            const createdAt = Number(p?.createdAt) || Date.now();
            const closedAt = p?.closedAt != null ? Number(p.closedAt) : undefined;
            const note = typeof p?.note === 'string' ? p.note : undefined;
            const legs = Array.isArray(p?.legs) ? p.legs.map((l: any) => ({
              leg: {
                symbol: String(l?.leg?.symbol || ''),
                strike: Number(l?.leg?.strike) || 0,
                optionType: l?.leg?.optionType === 'P' ? 'P' : 'C',
                expiryMs: Number(l?.leg?.expiryMs) || 0,
              },
              side: l?.side === 'long' ? 'long' : 'short',
              qty: Number(l?.qty) > 0 ? Number(l.qty) : 1,
              entryPrice: Number(l?.entryPrice) || 0,
            })).filter((l: any) => l.leg.symbol) : [];
            return { id, createdAt, closedAt, note, legs, favorite: typeof p?.favorite === 'boolean' ? p.favorite : undefined } as Position;
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
    { name: 'options-dashboard' }
  )
);
