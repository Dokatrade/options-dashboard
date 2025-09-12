import React from 'react';
import { useStore } from '../store/store';
import { subscribeOptionTicker } from '../services/ws';
import { midPrice, fetchOptionTickers } from '../services/bybit';
import type { Position, PositionLeg, SpreadPosition } from '../utils/types';
import { downloadCSV, toCSV } from '../utils/csv';
import { PositionView } from './PositionView';
import { EditPositionModal } from './EditPositionModal';

type Row = {
  id: string;
  kind: 'vertical' | 'multi';
  legs: PositionLeg[];
  createdAt: number;
  closedAt?: number;
  note?: string;
  // vertical extras
  cEnter?: number; // per contract
  qty?: number;
  favorite?: boolean;
};

function fromSpread(s: SpreadPosition): Row {
  // Derive per-leg entries with sensible fallbacks preserving net = cEnter
  const entryShort = s.entryShort != null
    ? s.entryShort
    : (s.entryLong != null ? s.cEnter + s.entryLong : s.cEnter);
  const entryLong = s.entryLong != null
    ? s.entryLong
    : (s.entryShort != null ? s.entryShort - s.cEnter : 0);
  return {
    id: 'S:' + s.id,
    kind: 'vertical',
    legs: [
      { leg: s.short, side: 'short', qty: s.qty ?? 1, entryPrice: entryShort },
      { leg: s.long,  side: 'long',  qty: s.qty ?? 1, entryPrice: entryLong },
    ],
    createdAt: s.createdAt,
    closedAt: s.closedAt,
    note: s.note,
    cEnter: s.cEnter,
    qty: s.qty ?? 1,
    favorite: s.favorite,
  };
}

function fromPosition(p: Position): Row {
  return {
    id: 'P:' + p.id,
    kind: 'multi',
    legs: p.legs,
    createdAt: p.createdAt,
    closedAt: p.closedAt,
    note: p.note,
    favorite: p.favorite,
  };
}

export function UnifiedPositionsTable() {
  const spreads = useStore((s) => s.spreads);
  const positions = useStore((s) => s.positions);
  const markClosed = useStore((s) => s.markClosed);
  const closePosition = useStore((s) => s.closePosition);
  const removeSpread = useStore((s) => s.remove);
  const removePosition = useStore((s) => s.removePosition);
  const toggleFavoriteSpread = useStore((s) => s.toggleFavoriteSpread);
  const toggleFavoritePosition = useStore((s) => s.toggleFavoritePosition);
  const [showClosed, setShowClosed] = React.useState(false);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});
  const [view, setView] = React.useState<Row | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [tab, setTab] = React.useState<'all'|'fav'>('all');
  const [sortKey, setSortKey] = React.useState<'date'|'pnl'|'theta'|'expiry'>('date');
  const [sortDir, setSortDir] = React.useState<'asc'|'desc'>('desc');

  // Load persisted UI prefs
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('positions-ui-v1');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s?.tab === 'all' || s?.tab === 'fav') setTab(s.tab);
      if (s?.sortKey === 'date' || s?.sortKey === 'pnl' || s?.sortKey === 'theta' || s?.sortKey === 'expiry') setSortKey(s.sortKey);
      if (s?.sortDir === 'asc' || s?.sortDir === 'desc') setSortDir(s.sortDir);
      if (typeof s?.showClosed === 'boolean') setShowClosed(s.showClosed);
    } catch {}
  }, []);

  // Persist UI prefs
  React.useEffect(() => {
    const payload = { tab, sortKey, sortDir, showClosed };
    try { localStorage.setItem('positions-ui-v1', JSON.stringify(payload)); } catch {}
  }, [tab, sortKey, sortDir, showClosed]);

  // Gamma removed from tables

  const rows: Row[] = React.useMemo(() => {
    const list = [
      ...spreads.map(fromSpread),
      ...positions.map(fromPosition),
    ].filter(r => (showClosed ? true : !r.closedAt));
    // Optional filter by favorites
    const filtered = tab === 'fav' ? list.filter(r => !!r.favorite) : list;
    // Base order; actual sort by metrics is applied at render time when calc() is available.
    return filtered;
  }, [spreads, positions, showClosed, tab]);

  React.useEffect(() => {
    const symbols = new Set<string>();
    rows.forEach(r => r.legs.forEach(l => symbols.add(l.leg.symbol)));
    const unsubs = Array.from(symbols).slice(0, 400).map(sym => subscribeOptionTicker(sym, (t) => setTickers(prev => {
      const cur = prev[t.symbol] || {};
      // merge without overwriting existing values with undefined/null
      const merged: any = { ...cur };
      const keys: string[] = Object.keys(t as any);
      for (const k of keys) {
        const v: any = (t as any)[k];
        if (v != null && !(Number.isNaN(v))) (merged as any)[k] = v;
      }
      return { ...prev, [t.symbol]: merged };
    })));
    return () => { unsubs.forEach(u => u()); };
  }, [rows]);

  // REST fallback to populate bid/ask for symbols missing them in WS
  React.useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const list = await fetchOptionTickers();
        if (!mounted) return;
        const map = Object.fromEntries(list.map(t => [t.symbol, t]));
        setTickers(prev => {
          const next = { ...prev } as Record<string, any>;
          rows.forEach(r => r.legs.forEach(l => {
            const sym = l.leg.symbol;
            const cur = next[sym] || {};
            const fresh: any = map[sym] || {};
            // Backfill missing fields (iv/greeks/oi/mark) from REST without clobbering existing values
            const merged: any = { ...cur };
            const keys = ['bid1Price','ask1Price','markPrice','markIv','indexPrice','delta','gamma','vega','theta','openInterest'];
            for (const k of keys) {
              const curV = cur[k];
              const freshV = fresh[k];
              if ((curV == null || Number.isNaN(curV)) && freshV != null && !Number.isNaN(freshV)) merged[k] = freshV;
            }
            next[sym] = merged;
          }));
          return next;
        });
      } catch {}
    };
    run();
    const id = setInterval(run, 30000);
    return () => { mounted = false; clearInterval(id); };
  }, [rows]);

  const calc = (r: Row) => {
    // Per-leg live mid and greeks
    const legs = r.legs.map((L) => {
      const t = tickers[L.leg.symbol] || {};
      const mid = midPrice(t) ?? 0;
      const greeks = {
        delta: t?.delta != null ? Number(t.delta) : 0,
        gamma: t?.gamma != null ? Number(t.gamma) : 0,
        vega: t?.vega != null ? Number(t.vega) : 0,
        theta: t?.theta != null ? Number(t.theta) : 0,
      };
      const bid = t?.bid1Price != null ? Number(t.bid1Price) : undefined;
      const ask = t?.ask1Price != null ? Number(t.ask1Price) : undefined;
      const spread = bid != null && ask != null && bid > 0 && ask > 0 ? Math.max(0, ask - bid) : undefined;
      const oi = t?.openInterest != null ? Number(t.openInterest) : undefined;
      return { ...L, mid, greeks, bid, ask, spread, oi };
    });
    const netEntry = legs.reduce((a, L) => a + (L.side === 'short' ? 1 : -1) * L.entryPrice * L.qty, 0);
    const netMid = legs.reduce((a, L) => a + (L.side === 'short' ? 1 : -1) * L.mid * L.qty, 0);
    const pnl = netEntry - netMid;
    const g = legs.reduce((a, L) => {
      const s = L.side === 'long' ? 1 : -1;
      return {
        delta: a.delta + s * L.greeks.delta * L.qty,
        gamma: a.gamma + s * L.greeks.gamma * L.qty,
        vega: a.vega + s * L.greeks.vega * L.qty,
        theta: a.theta + s * L.greeks.theta * L.qty,
      };
    }, { delta: 0, gamma: 0, vega: 0, theta: 0 });
    const spreads = legs.map(L => L.spread).filter((v): v is number => v != null && Number.isFinite(v));
    const ois = legs.map(L => L.oi).filter((v): v is number => v != null && Number.isFinite(v));
    const spreadPcts = legs
      .map(L => (L.spread != null && Number.isFinite(L.spread) && L.mid > 0) ? (L.spread / L.mid) * 100 : undefined)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const liq = {
      maxSpread: spreads.length ? Math.max(...spreads) : undefined,
      minOI: ois.length ? Math.min(...ois) : undefined,
      maxSpreadPct: spreadPcts.length ? Math.max(...spreadPcts) : undefined,
    } as { maxSpread?: number; minOI?: number; maxSpreadPct?: number };

    // Vertical extras
    let width: number | undefined;
    let maxLoss: number | undefined;
    let dte: number | undefined;
    const expSet = Array.from(new Set(legs.map(L => L.leg.expiryMs)));
    if (r.kind === 'vertical' && expSet.length === 1) {
      const strikes = legs.map(L => L.leg.strike);
      width = Math.abs(strikes[0] - strikes[1]);
      maxLoss = Math.max(0, (width - (r.cEnter ?? 0)) * (r.qty ?? 1));
      dte = Math.max(0, Math.round((expSet[0] - Date.now()) / (1000 * 60 * 60 * 24)));
    }

    return { legs, netEntry, netMid, pnl, greeks: g, liq, width, maxLoss, dte };
  };

  const exportCSV = () => {
    const rowsCSV = rows.map((r) => {
      const c = calc(r);
      return {
        id: r.id,
        kind: r.kind,
        legs: r.legs.map(L => `${L.side}${L.leg.optionType}${L.leg.strike}x${L.qty}@${L.entryPrice}`).join(' | '),
        expiry: Array.from(new Set(r.legs.map(L => new Date(L.leg.expiryMs).toISOString().slice(0,10)))).join(' & '),
        netEntry: c.netEntry.toFixed(2),
        netMid: c.netMid.toFixed(2),
        pnl: c.pnl.toFixed(2),
        delta: c.greeks.delta.toFixed(3),
        vega: c.greeks.vega.toFixed(3),
        theta: c.greeks.theta.toFixed(3),
        maxSpread: (c.liq.maxSpread != null && isFinite(c.liq.maxSpread)) ? c.liq.maxSpread.toFixed(2) : '',
        minOI: (c.liq.minOI != null && isFinite(c.liq.minOI)) ? String(c.liq.minOI) : '',
        width: c.width != null ? c.width.toFixed(2) : '',
        maxLoss: c.maxLoss != null ? c.maxLoss.toFixed(2) : '',
        dte: c.dte != null ? String(c.dte) : '',
        note: r.note ?? '',
      };
    });
    const csv = toCSV(rowsCSV);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    downloadCSV(`positions-${ts}.csv`, csv);
  };

  const isVerticalLike = (legs: PositionLeg[]) => {
    if (legs.length !== 2) return false;
    const [a, b] = legs;
    const sameType = a.leg.optionType === b.leg.optionType;
    const sameExp = a.leg.expiryMs === b.leg.expiryMs;
    const opposite = a.side !== b.side;
    return sameType && sameExp && opposite;
  };

  const buildSpreadForView = (r: Row) => {
    const [a, b] = r.legs;
    const short = a.side === 'short' ? a : b;
    const long = a.side === 'long' ? a : b;
    const qty = Math.min(Number(short.qty)||1, Number(long.qty)||1) || 1;
    const cEnter = (r.cEnter != null ? r.cEnter : (Number(short.entryPrice)||0) - (Number(long.entryPrice)||0));
    return {
      position: { id: r.id, short: short.leg, long: long.leg, cEnter, qty, createdAt: r.createdAt } as any,
      calc: {
        width: Math.abs(short.leg.strike - long.leg.strike),
        maxLoss: Math.max(0, Math.abs(short.leg.strike - long.leg.strike) - cEnter) * qty,
        priceNow: undefined,
        pnl: undefined,
        pnlPct: undefined,
        deltaShort: undefined,
      } as any
    };
  };

  const onCloseRow = (r: Row) => {
    if (r.id.startsWith('S:')) markClosed(r.id.slice(2)); else closePosition(r.id.slice(2));
  };
  const onDeleteRow = (r: Row) => {
    if (r.id.startsWith('S:')) removeSpread(r.id.slice(2)); else removePosition(r.id.slice(2));
  };

  return (
    <div>
      <h3>My Positions</h3>
      <div style={{display:'flex', gap: 12, alignItems:'center', marginBottom: 6}}>
        <label style={{display:'flex', gap:6, alignItems:'center'}}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          <span className="muted">Show closed</span>
        </label>
        <button className="ghost" onClick={exportCSV}>Export CSV</button>
        <div style={{display:'flex', gap:6, marginLeft: 'auto'}}>
          <button className={tab==='all' ? 'primary' : 'ghost'} onClick={() => setTab('all')}>All</button>
          <button className={tab==='fav' ? 'primary' : 'ghost'} onClick={() => setTab('fav')}>Favorites</button>
        </div>
        <div style={{display:'flex', gap:6}}>
          <span className="muted">Sort:</span>
          <button className={sortKey==='date' ? 'primary' : 'ghost'} onClick={() => setSortKey('date')}>Date</button>
          <button className={sortKey==='pnl' ? 'primary' : 'ghost'} onClick={() => setSortKey('pnl')}>PnL</button>
          <button className={sortKey==='theta' ? 'primary' : 'ghost'} onClick={() => setSortKey('theta')}>Theta</button>
          <button className={sortKey==='expiry' ? 'primary' : 'ghost'} onClick={() => { setSortKey('expiry'); setSortDir('asc'); }}>Expiry</button>
          <button className="ghost" title={sortDir==='desc' ? 'Descending' : 'Ascending'} onClick={() => setSortDir(d => d==='desc'?'asc':'desc')}>{sortDir==='desc' ? '↓' : '↑'}</button>
        </div>
      </div>
      <div style={{overflowX: 'auto'}}>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Legs</th>
              <th>Expiry / DTE</th>
              <th>Net entry</th>
              <th>Net mid</th>
              <th>PnL ($)</th>
              <th>Δ</th>
              <th>Vega</th>
              <th>Θ ($/day)</th>
              <th>Liquidity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const augmented = rows.map((r) => ({ r, c: calc(r) }));
              augmented.sort((A, B) => {
                // Favorites first
                const fa = A.r.favorite ? 1 : 0;
                const fb = B.r.favorite ? 1 : 0;
                if (fa !== fb) return fb - fa;
                // Then by chosen sort key (desc)
                const sgn = sortDir === 'desc' ? 1 : -1;
                if (sortKey === 'date') return sgn * ((B.r.createdAt || 0) - (A.r.createdAt || 0));
                if (sortKey === 'pnl') return sgn * ((B.c.pnl || 0) - (A.c.pnl || 0));
                if (sortKey === 'theta') return sgn * ((B.c.greeks.theta || 0) - (A.c.greeks.theta || 0));
                if (sortKey === 'expiry') {
                  const eA = Math.min(...A.r.legs.map(L => Number(L.leg.expiryMs) || 0));
                  const eB = Math.min(...B.r.legs.map(L => Number(L.leg.expiryMs) || 0));
                  return sgn * (eB - eA);
                }
                return 0;
              });
              return augmented.map(({ r, c }) => {
              const expiries = Array.from(new Set(r.legs.map(L => L.leg.expiryMs))).sort();
              const expLabel = expiries.length === 1 ? new Date(expiries[0]).toISOString().slice(0,10) : 'mixed';
              const dte = c.dte != null ? `${c.dte}d` : (expiries.length === 1 ? `${Math.max(0, Math.round((expiries[0]-Date.now())/(86400000)))}d` : '—');
              const typeLabel = strategyName(r.legs);
              return (
                <>
                  <tr key={r.id}>
                    <td style={r.favorite ? { borderLeft: '3px solid rgba(255, 215, 0, 0.5)', paddingLeft: 6 } : undefined}>{typeLabel}</td>
                    <td>
                      {r.legs.map((L, i) => (
                        <div key={i} className="muted">{L.side} {L.leg.optionType} {L.leg.strike} × {L.qty}</div>
                      ))}
                    </td>
                    <td>{expLabel} · {dte}</td>
                    <td>{c.netEntry.toFixed(2)}</td>
                    <td>{c.netMid.toFixed(2)}</td>
                    <td>{c.pnl.toFixed(2)}</td>
                    <td>{c.greeks.delta.toFixed(3)}</td>
                    <td>{c.greeks.vega.toFixed(3)}</td>
                    <td>{c.greeks.theta.toFixed(3)}</td>
                    <td>
                      {c.liq.maxSpread != null ? `$${c.liq.maxSpread.toFixed(2)}` : '—'} · OI {c.liq.minOI != null ? c.liq.minOI : '—'}
                      {(() => {
                        const sp = c.liq.maxSpreadPct;
                        const oi = c.liq.minOI;
                        let label: 'A' | 'B' | 'C' | 'D' = 'D';
                        if (sp != null && isFinite(sp) && oi != null && isFinite(oi)) {
                          if (sp < 1 && oi >= 2000) label = 'A';
                          else if (sp < 2 && oi >= 1000) label = 'B';
                          else if (sp < 3 && oi >= 300) label = 'C';
                          else label = 'D';
                        }
                        const style: React.CSSProperties = { background: 'rgba(128,128,128,.18)', color: '#7a7a7a' };
                        return (
                          <span style={{...style, marginLeft: 8, padding: '1px 6px', borderRadius: 8, fontSize: 'calc(1em - 3px)'}}>{label}</span>
                        );
                      })()}
                    </td>
                    <td>
                      <button className="ghost" style={{fontSize: 18, lineHeight: 1}} title={r.favorite ? 'Unfavorite' : 'Favorite'} onClick={() => {
                        if (r.id.startsWith('S:')) toggleFavoriteSpread(r.id.slice(2));
                        else toggleFavoritePosition(r.id.slice(2));
                      }}>{r.favorite ? '★' : '☆'}</button>
                      <button className="ghost" title={expanded[r.id] ? 'Hide legs' : 'Show legs'} onClick={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))}>{expanded[r.id] ? '▴' : '▾'}</button>
                      <button className="ghost" onClick={() => setView(r)}>View</button>
                      {r.kind === 'multi' && <button className="ghost" onClick={() => setEditId(r.id.slice(2))}>Edit</button>}
                      <button className="ghost" onClick={() => onCloseRow(r)}>Mark closed</button>
                      <button className="ghost" onClick={() => onDeleteRow(r)}>Delete</button>
                    </td>
                  </tr>
                  {expanded[r.id] && (
                    <tr>
                      <td colSpan={11}>
                        <div className="grid" style={{gap: 6}}>
                          {r.legs.map((L, i) => {
                            const t = tickers[L.leg.symbol] || {};
                            const bid = t?.bid1Price != null ? Number(t.bid1Price) : undefined;
                            const ask = t?.ask1Price != null ? Number(t.ask1Price) : undefined;
                            const mid = midPrice(t);
                            const iv = t?.markIv != null ? Number(t.markIv) : undefined;
                            const dRaw = t?.delta != null ? Number(t.delta) : undefined;
                            const vRaw = t?.vega != null ? Number(t.vega) : undefined;
                            const thRaw = t?.theta != null ? Number(t.theta) : undefined;
                            const sgn = L.side === 'long' ? 1 : -1;
                            const d = dRaw != null ? sgn * dRaw : undefined;
                            const v = vRaw != null ? sgn * vRaw : undefined;
                            const th = thRaw != null ? sgn * thRaw : undefined;
                            const oi = t?.openInterest != null ? Number(t.openInterest) : undefined;
                            return (
                              <div key={L.leg.symbol} style={{border: '1px solid var(--border)', borderRadius: 8, padding: 6, fontSize: 'calc(1em - 1.5px)'}}>
                                <div style={{display:'flex', justifyContent:'space-between', marginBottom: 2}}>
                                  <div><strong>{L.side}</strong> {L.leg.optionType} {L.leg.strike} × {L.qty}</div>
                                  <div className="muted">{new Date(L.leg.expiryMs).toISOString().slice(0,10)}</div>
                                </div>
                                <div className="grid" style={{gridTemplateColumns:'2fr repeat(8, minmax(0,1fr))', gap: 6}}>
                                  <div style={{paddingRight:12}}>
                                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Symbol</div>
                                    <div title={L.leg.symbol} style={{whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word'}}>{L.leg.symbol}</div>
                                  </div>
                                  <div style={{paddingRight:8}}><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, whiteSpace:'nowrap', fontWeight:600}}>Bid / Ask</div><div>{bid != null ? bid.toFixed(2) : '—'} / {ask != null ? ask.toFixed(2) : '—'}</div></div>
                                  <div style={{marginLeft:8}}><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Mid</div><div>{mid != null ? mid.toFixed(2) : '—'}</div></div>
                                  <div style={{paddingRight:8}}><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, whiteSpace:'nowrap', fontWeight:600}}>Entry @</div><div>{isFinite(L.entryPrice) ? `$${L.entryPrice.toFixed(2)}` : '—'}</div></div>
                                  <div style={{marginLeft:8}}><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>IV %</div><div>{iv != null ? iv.toFixed(1) : '—'}</div></div>
                                  <div><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Δ</div><div>{d != null ? d.toFixed(3) : '—'}</div></div>
                                  <div><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Vega</div><div>{v != null ? v.toFixed(3) : '—'}</div></div>
                                  <div><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Θ</div><div>{th != null ? th.toFixed(3) : '—'}</div></div>
                                  <div><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>OI</div><div>{oi != null ? oi : '—'}</div></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
              });
            })()}
          </tbody>
        </table>
      </div>
      {view && (
        <PositionView legs={view.legs} createdAt={view.createdAt} note={view.note} title={strategyName(view.legs)} onClose={() => setView(null)} />
      )}
      {editId && <EditPositionModal id={editId} onClose={() => setEditId(null)} />}
    </div>
  );
}
  const netEntryFor = (legs: PositionLeg[]) => legs.reduce((a, L) => a + (L.side === 'short' ? 1 : -1) * (Number(L.entryPrice) || 0) * (Number(L.qty) || 1), 0);

  const strategyName = (legs: PositionLeg[]): string => {
    if (!legs.length) return '—';
    const Ls = legs.map(l => ({ side: l.side, type: l.leg.optionType, exp: l.leg.expiryMs, k: l.leg.strike, qty: l.qty }));
    const tol = 1e-6;
    const same = (a: number, b: number) => Math.abs(a - b) <= tol;
    const allSameExp = Ls.every(x => same(x.exp, Ls[0].exp));
    const allSameType = Ls.every(x => x.type === Ls[0].type);
    const byType = (t: 'C' | 'P') => Ls.filter(x => x.type === t);
    const bySide = (s: 'long' | 'short') => Ls.filter(x => x.side === s);
    const sumQty = (arr: typeof Ls) => arr.reduce((a, x) => a + (Number(x.qty) || 0), 0);
    const sortedByK = (arr: typeof Ls) => [...arr].sort((a, b) => a.k - b.k);
    const net = netEntryFor(legs);

    // 1 leg
    if (Ls.length === 1) {
      const a = Ls[0];
      const side = a.side === 'long' ? 'Long' : 'Short';
      const kind = a.type === 'C' ? 'Call' : 'Put';
      return `${side} ${kind}`;
    }

    // 2 legs
    if (Ls.length === 2) {
      const [a, b] = Ls;
      const sameType = a.type === b.type;
      const sameExp = same(a.exp, b.exp);
      const sameStrike = same(a.k, b.k);
      const bothLong = a.side === 'long' && b.side === 'long';
      const bothShort = a.side === 'short' && b.side === 'short';
      const opposite = a.side !== b.side;
      if (!sameType && sameExp) {
        if (bothLong) return sameStrike ? 'Long Straddle' : 'Long Strangle';
        if (bothShort) return sameStrike ? 'Short Straddle' : 'Short Strangle';
      }
      if (sameType && opposite) {
        const typ = a.type === 'C' ? 'Call' : 'Put';
        if (!sameExp && sameStrike) {
          const longIsLater = (a.side === 'long' ? a : b).exp > (a.side === 'short' ? a : b).exp;
          return `${longIsLater ? 'Long' : 'Short'} ${typ} Calendar`;
        }
        if (!sameExp && !sameStrike) {
          const longIsLater = (a.side === 'long' ? a : b).exp > (a.side === 'short' ? a : b).exp;
          return `${longIsLater ? 'Long' : 'Short'} ${typ} Diagonal`;
        }
        if (sameExp && !sameStrike) {
          const longK = (a.side === 'long' ? a : b).k;
          const shortK = (a.side === 'short' ? a : b).k;
          const isCredit = net > 0;
          if (typ === 'Call') {
            const bull = longK < shortK;
            return `${bull ? 'Bull' : 'Bear'} Call ${isCredit ? 'Credit' : 'Debit'} Spread`;
          } else {
            const bull = shortK > longK;
            return `${bull ? 'Bull' : 'Bear'} Put ${isCredit ? 'Credit' : 'Debit'} Spread`;
          }
        }
      }
    }

    // 3 legs
    if (Ls.length === 3) {
      if (allSameExp && allSameType) {
        const S = sortedByK(Ls);
        const sgnQty = S.map(x => (x.side === 'long' ? 1 : -1) * (Number(x.qty) || 0));
        const isButterflyLike = same(Math.abs(sgnQty[0]), Math.abs(sgnQty[2])) && same(Math.abs(sgnQty[1]), Math.abs(sgnQty[0] + sgnQty[2]));
        if (isButterflyLike) {
          const longWings = sgnQty[0] > 0 && sgnQty[2] > 0 && sgnQty[1] < 0;
          const shortWings = sgnQty[0] < 0 && sgnQty[2] < 0 && sgnQty[1] > 0;
          const wingLeft = S[1].k - S[0].k;
          const wingRight = S[2].k - S[1].k;
          const broken = !same(wingLeft, wingRight);
          const typ = Ls[0].type === 'C' ? 'Call' : 'Put';
          if (longWings) return `${broken ? 'Broken Wing ' : ''}Long ${typ} Butterfly`;
          if (shortWings) return `${broken ? 'Broken Wing ' : ''}Short ${typ} Butterfly`;
        }
        const longs = bySide('long');
        const shorts = bySide('short');
        if ((longs.length === 1 && shorts.length === 2) || (longs.length === 2 && shorts.length === 1)) {
          const typ = Ls[0].type === 'C' ? 'Call' : 'Put';
          const lq = sumQty(longs);
          const sq = sumQty(shorts);
          const ratio = longs.length === 1 ? `${Math.round(lq)}x${Math.round(sq)}` : `${Math.round(lq)}x${Math.round(sq)}`;
          return `Ratio ${typ} Spread (${ratio})`;
        }
      }
      return 'Three‑leg Combo';
    }

    // 4 legs
    if (Ls.length === 4) {
      const calls = byType('C');
      const puts = byType('P');
      if (allSameExp) {
        if (calls.length === 2 && puts.length === 2) {
          // Iron Butterfly
          const cKs = sortedByK(calls).map(x => x.k);
          const pKs = sortedByK(puts).map(x => x.k);
          const midK = cKs.find(k => pKs.includes(k));
          if (midK != null) {
            const cMid = calls.find(x => same(x.k, midK));
            const pMid = puts.find(x => same(x.k, midK));
            const wings = Ls.filter(x => !same(x.k, midK));
            if (cMid && pMid && wings.length === 2) {
              const midsShort = cMid.side === 'short' && pMid.side === 'short';
              const midsLong = cMid.side === 'long' && pMid.side === 'long';
              if (midsShort) return 'Short Iron Butterfly';
              if (midsLong) return 'Long Iron Butterfly';
            }
          }
          // Iron Condor
          const c = sortedByK(calls);
          const p = sortedByK(puts);
          const condorShort = c[0].side === 'short' && c[1].side === 'long' && p[0].side === 'long' && p[1].side === 'short';
          const condorLong  = c[0].side === 'long' && c[1].side === 'short' && p[0].side === 'short' && p[1].side === 'long';
          if (condorShort) return 'Short Iron Condor';
          if (condorLong) return 'Long Iron Condor';
        }
        // Same-type Condor (all Calls or all Puts)
        if (allSameType) {
          const S = sortedByK(Ls);
          const wingsLong = S[0].side === 'long' && S[3].side === 'long' && S[1].side === 'short' && S[2].side === 'short';
          const wingsShort = S[0].side === 'short' && S[3].side === 'short' && S[1].side === 'long' && S[2].side === 'long';
          const typ = Ls[0].type === 'C' ? 'Call' : 'Put';
          if (wingsLong) return `Long ${typ} Condor`;
          if (wingsShort) return `Short ${typ} Condor`;
        }
        // Box Spread
        if (calls.length === 2 && puts.length === 2) {
          const kSet = Array.from(new Set(Ls.map(x => x.k))).sort((a,b)=>a-b);
          if (kSet.length === 2) {
            const k1 = kSet[0], k2 = kSet[1];
            const hasLongCallK1 = calls.some(x => same(x.k, k1) && x.side === 'long');
            const hasShortCallK2 = calls.some(x => same(x.k, k2) && x.side === 'short');
            const hasLongPutK2 = puts.some(x => same(x.k, k2) && x.side === 'long');
            const hasShortPutK1 = puts.some(x => same(x.k, k1) && x.side === 'short');
            const longBox = hasLongCallK1 && hasShortCallK2 && hasLongPutK2 && hasShortPutK1;
            const shortBox = calls.some(x => same(x.k, k1) && x.side === 'short') && calls.some(x => same(x.k, k2) && x.side === 'long') &&
                             puts.some(x => same(x.k, k2) && x.side === 'short') && puts.some(x => same(x.k, k1) && x.side === 'long');
            if (longBox) return 'Long Box Spread';
            if (shortBox) return 'Short Box Spread';
          }
        }
      } else {
        // Double Calendar / Double Diagonal
        const expSet = Array.from(new Set(Ls.map(x => x.exp))).sort();
        if (expSet.length === 2 && calls.length === 2 && puts.length === 2) {
          const cStrikeSame = same(calls[0].k, calls[1].k);
          const pStrikeSame = same(puts[0].k, puts[1].k);
          const cOppSides = calls[0].side !== calls[1].side;
          const pOppSides = puts[0].side !== puts[1].side;
          if (cStrikeSame && pStrikeSame && cOppSides && pOppSides) return 'Double Calendar (Straddle)';
          if (!cStrikeSame && !pStrikeSame && cOppSides && pOppSides) return 'Double Diagonal';
        }
      }
      return 'Four‑leg Combo';
    }

    if (Ls.length >= 5) return `Complex (${Ls.length} legs)`;
    return 'Multi‑leg';
  };
