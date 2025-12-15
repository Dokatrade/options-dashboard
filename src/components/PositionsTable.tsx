import React from 'react';
import { useStore } from '../store/store';
import { subscribeOptionTicker } from '../services/ws';
import { midPrice } from '../services/bybit';

export function PositionsTable() {
  const positions = useStore((s) => s.positions.filter(p => !p.closedAt));
  const closePosition = useStore((s) => s.closePosition);
  const removePosition = useStore((s) => s.removePosition);
  const [tickers, setTickers] = React.useState<Record<string, any>>({});

  React.useEffect(() => {
    const symbols = new Set<string>();
    positions.forEach(p => p.legs.forEach(l => symbols.add(l.leg.symbol)));
    const unsubs = Array.from(symbols).slice(0, 250).map(sym => subscribeOptionTicker(sym, (t) => setTickers(prev => {
      const cur = prev[t.symbol] || {};
      const merged: any = { ...cur };
      const keys: string[] = Object.keys(t as any);
      for (const k of keys) {
        const v: any = (t as any)[k];
        if (v != null && !(Number.isNaN(v))) (merged as any)[k] = v;
      }
      return { ...prev, [t.symbol]: merged };
    })));
    return () => { unsubs.forEach(u => u()); };
  }, [positions]);

  if (!positions.length) return null;

  return (
    <div>
      <h3>My Positions (multi‑leg)</h3>
      <div style={{overflowX: 'auto'}}>
        <table>
          <thead>
            <tr>
              <th>Legs</th>
              <th>Expiry</th>
              <th>Net entry</th>
              <th>Net mid</th>
              <th>PnL ($)</th>
              <th>Δ (sum)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const legs = p.legs.filter(l => !l.hidden).map((l) => {
                const t = tickers[l.leg.symbol];
                const m = midPrice(t) ?? 0;
                const symbol = String(l.leg.symbol || '');
                const expiryMs = Number(l.leg.expiryMs) || 0;
                const isPerp = !symbol.includes('-') || expiryMs <= 0;
                const delta = t?.delta != null ? Number(t.delta) : (isPerp ? 1 : 0);
                return { ...l, mid: m, delta };
              });
              const netEntry = legs.reduce((a, l) => a + (l.side === 'short' ? 1 : -1) * l.entryPrice * l.qty, 0);
              const netMid = legs.reduce((a, l) => a + (l.side === 'short' ? 1 : -1) * l.mid * l.qty, 0);
              const pnl = netEntry - netMid;
              const dSum = legs.reduce((a, l) => a + (l.side === 'short' ? -1 : 1) * Math.abs(l.delta) * l.qty, 0);
              const expiries = Array.from(new Set(legs.map(l => l.leg.expiryMs))).sort();
              const expLabel = expiries.length === 1 ? new Date(expiries[0]).toISOString().slice(0,10) : 'mixed';
              return (
                <tr key={p.id}>
                  <td>
                    {legs.map((l, i) => (
                      <div key={i} className="muted">{l.side} {l.leg.optionType} {l.leg.strike} × {l.qty}</div>
                    ))}
                  </td>
                  <td>{expLabel}</td>
                  <td>{netEntry.toFixed(2)}</td>
                  <td>{netMid.toFixed(2)}</td>
                  <td>{pnl.toFixed(2)}</td>
                  <td>{dSum.toFixed(3)}</td>
                  <td>
                    <button className="ghost" onClick={() => { if (window.confirm('Mark this position as closed?')) closePosition(p.id); }}>Mark closed</button>
                    <button className="ghost" onClick={() => { if (window.confirm('Delete this position? This cannot be undone.')) removePosition(p.id); }}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
