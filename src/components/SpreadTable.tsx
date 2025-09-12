import React from 'react';
import { useStore } from '../store/store';
import { fetchOptionTickers, midPrice } from '../services/bybit';
import { subscribeTicker } from '../services/ws';
import { PositionView } from './PositionView';

type RowCalc = {
  priceNow?: number;
  pnl?: number;
  pnlPct?: number;
  width: number;
  maxLoss: number;
  dte: number;
  deltaShort?: number;
  status: { color: 'green' | 'yellow' | 'red'; reason: string };
};

function compute(p: ReturnType<typeof useStore.getState>['spreads'][number], tick: Record<string, any>): RowCalc {
  const tShort = tick[p.short.symbol];
  const tLong = tick[p.long.symbol];
  const midShort = midPrice(tShort);
  const midLong = midPrice(tLong);
  const priceNow = midShort != null && midLong != null ? (midShort - midLong) : undefined;
  const pnlPer = priceNow != null ? (p.cEnter - priceNow) : undefined;
  const pnl = pnlPer != null ? pnlPer * (p.qty ?? 1) : undefined;
  const pnlPct = pnlPer != null ? (pnlPer / p.cEnter) * 100 : undefined;
  const vertical = p.short.expiryMs === p.long.expiryMs;
  const width = vertical ? Math.abs(p.short.strike - p.long.strike) : undefined;
  const maxLossPer = width != null ? Math.max(0, width - p.cEnter) : undefined;
  const maxLoss = maxLossPer != null ? maxLossPer * (p.qty ?? 1) : undefined;
  const dte = Math.max(0, Math.round((p.short.expiryMs - Date.now()) / (1000 * 60 * 60 * 24)));
  const deltaShort = tShort?.delta != null ? Math.abs(Number(tShort.delta)) : undefined;
  const spot = tShort?.indexPrice != null ? Number(tShort.indexPrice) : undefined;
  const isCall = p.short.optionType === 'C';

  // Traffic light rules
  let color: RowCalc['status']['color'] = 'green';
  let reason = 'OK';
  const loss = pnl != null && pnl < 0 ? Math.abs(pnl) : 0;
  const spotCross = spot != null ? (isCall ? spot >= p.short.strike : spot <= p.short.strike) : false;
  if ((deltaShort ?? 0) > 0.35 || spotCross || (priceNow != null && priceNow > p.cEnter * 2) || dte <= 7) {
    color = 'red'; reason = spotCross ? 'Spot crossed short strike' : 'Greeks/credit/DTE';
  } else if ((deltaShort ?? 0) >= 0.31 || (priceNow != null && priceNow > p.cEnter * 1.5) || (dte >= 7 && dte <= 10)) {
    color = 'yellow'; reason = 'Monitoring: Δ/credit/DTE';
  }

  return { priceNow, pnl, pnlPct, width: width ?? NaN, maxLoss: maxLoss ?? NaN, dte, deltaShort, status: { color, reason } };
}

export function SpreadTable() {
  const spreads = useStore((s) => s.spreads.filter((p) => !p.closedAt));
  const markClosed = useStore((s) => s.markClosed);
  const remove = useStore((s) => s.remove);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [viewId, setViewId] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});


  // Initial fetch once, then WS live updates
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const list = await fetchOptionTickers();
        if (!mounted) return;
        const map: Record<string, any> = Object.fromEntries(list.map((t) => [t.symbol, t]));
        setTickers(map);
        setErr(null);
      } catch (e: any) {
        setErr(e?.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Subscribe to WS per visible leg
  React.useEffect(() => {
    const unsubs: Array<() => void> = [];
    spreads.forEach((p) => {
      [p.short.symbol, p.long.symbol].forEach((sym) => {
        const off = subscribeTicker(sym, (t) => {
          setTickers((prev) => ({ ...prev, [t.symbol]: { ...(prev[t.symbol] || {}), ...t } }));
        });
        unsubs.push(off);
      });
    });
    return () => { unsubs.forEach((u) => u()); };
  }, [spreads]);

  if (!spreads.length) return <div className="muted">No positions yet. Add a spread.</div>;

  return (
    <div>
      <h3>My Spreads</h3>
      {loading && <div className="muted">Loading…</div>}
      {err && <div className="muted">Error: {err}</div>}
      <div style={{overflowX: 'auto'}}>
        <table>
          <thead>
            <tr>
              <th>Expiry / DTE</th>
              <th>K_sell / K_buy</th>
              <th>Width</th>
              <th>Entry (C)</th>
              <th>Mid now</th>
              <th>PnL ($)</th>
              <th>PnL %</th>
              <th>Δ short</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {spreads.map((p) => {
              const c = compute(p, tickers);
              const exp = new Date(p.short.expiryMs).toISOString().slice(0, 10);
              return (
                <>
                  <tr key={p.id}>
                    <td>{exp} · {c.dte}d</td>
                    <td>{p.short.strike} / {p.long.strike}</td>
                    <td>{Number.isFinite(c.width) ? c.width.toFixed(2) : '—'}</td>
                    <td>{p.cEnter.toFixed(2)} × {p.qty ?? 1}</td>
                    <td>{c.priceNow != null ? c.priceNow.toFixed(2) : '—'}</td>
                    <td>{c.pnl != null ? c.pnl.toFixed(2) : '—'}</td>
                    <td>{c.pnlPct != null ? c.pnlPct.toFixed(1) + '%' : '—'}</td>
                    <td>{c.deltaShort != null ? c.deltaShort.toFixed(3) : '—'}</td>
                    <td><span className={`status ${c.status.color}`} title={c.status.reason}>{c.status.color === 'green' ? '🟢' : c.status.color === 'yellow' ? '🟡' : '🔴'}</span></td>
                    <td>
                      <button className="ghost" title={expanded[p.id] ? 'Hide legs' : 'Show legs'} onClick={() => setExpanded((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}>{expanded[p.id] ? '▴' : '▾'}</button>
                      <button className="ghost" onClick={() => setViewId(p.id)}>View</button>
                      <button className="ghost" onClick={() => markClosed(p.id)}>Mark closed</button>
                      <button className="ghost" onClick={() => remove(p.id)}>Delete</button>
                    </td>
                  </tr>
                  {expanded[p.id] && (
                    <tr>
                      <td colSpan={10}>
                        <div className="grid" style={{gap: 6}}>
                          {[{ side: 'short' as const, leg: p.short }, { side: 'long' as const, leg: p.long }].map(({ side, leg }) => {
                            const t = tickers[leg.symbol];
                            const m = midPrice(t);
                            const iv = t?.markIv != null ? Number(t.markIv) : undefined;
                            const dRaw = t?.delta != null ? Number(t.delta) : undefined;
                            const d = dRaw != null ? (side === 'long' ? dRaw : -dRaw) : undefined;
                            const thRaw = t?.theta != null ? Number(t.theta) : undefined;
                            const th = thRaw != null ? (side === 'long' ? thRaw : -thRaw) : undefined;
                            const bid = t?.bid1Price != null ? Number(t.bid1Price) : undefined;
                            const ask = t?.ask1Price != null ? Number(t.ask1Price) : undefined;
                            return (
                              <div key={leg.symbol} style={{border: '1px solid var(--border)', borderRadius: 8, padding: 6, fontSize: 'calc(1em - 1.5px)'}}>
                                <div style={{display:'flex', justifyContent:'space-between', marginBottom: 2}}>
                                  <div><strong>{side}</strong> {leg.optionType} {leg.strike}</div>
                                  <div className="muted">{new Date(leg.expiryMs).toISOString().slice(0,10)}</div>
                                </div>
                                <div className="grid" style={{gridTemplateColumns:'2fr repeat(6, minmax(0,1fr))', gap: 6}}>
                                  <div style={{paddingRight:12}}>
                                    <div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Symbol</div>
                                    <div title={leg.symbol} style={{whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word'}}>{leg.symbol}</div>
                                  </div>
                                  <div style={{paddingRight:8}}><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, whiteSpace:'nowrap', fontWeight:600}}>Bid / Ask</div><div>{bid != null ? bid.toFixed(2) : '—'} / {ask != null ? ask.toFixed(2) : '—'}</div></div>
                                  <div style={{marginLeft:8}}><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Mid</div><div>{m != null ? m.toFixed(2) : '—'}</div></div>
                                  <div><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>IV %</div><div>{iv != null ? iv.toFixed(1) : '—'}</div></div>
                                  <div><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Delta</div><div>{d != null ? d.toFixed(3) : '—'}</div></div>
                                  <div><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Vega</div><div>{/* vega per leg with sign */}{(() => { const t = tickers[leg.symbol]; const vRaw = t?.vega != null ? Number(t.vega) : undefined; const v = vRaw != null ? (side === 'long' ? vRaw : -vRaw) : undefined; return v != null ? v.toFixed(3) : '—'; })()}</div></div>
                                  <div><div className="muted" style={{fontSize:'calc(1em - 1px)', lineHeight:1.1, fontWeight:600}}>Theta</div><div>{th != null ? th.toFixed(3) : '—'}</div></div>
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
            })}
          </tbody>
        </table>
      </div>
      {viewId && (() => {
        const pos = spreads.find(s => s.id === viewId);
        if (!pos) return null;
        // Build PositionView-compatible legs with entry attribution preserving net = cEnter per contract
        const qty = pos.qty ?? 1;
        const entryShort = pos.entryShort != null
          ? pos.entryShort
          : (pos.entryLong != null ? pos.cEnter + pos.entryLong : pos.cEnter);
        const entryLong = pos.entryLong != null
          ? pos.entryLong
          : (pos.entryShort != null ? pos.entryShort - pos.cEnter : 0);
        const legs = [
          { leg: pos.short, side: 'short' as const, qty, entryPrice: entryShort },
          { leg: pos.long,  side: 'long'  as const, qty, entryPrice: entryLong },
        ];
        const title = `Vertical ${pos.short.optionType} ${pos.short.strike}/${pos.long.strike}`;
        return <PositionView legs={legs} createdAt={pos.createdAt} note={pos.note} title={title} onClose={() => setViewId(null)} />;
      })()}
    </div>
  );
}
