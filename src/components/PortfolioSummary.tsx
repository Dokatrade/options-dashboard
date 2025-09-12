import React from 'react';
import { useStore } from '../store/store';
import { DataBackup } from './DataBackup';

export function PortfolioSummary() {
  const spreads = useStore((s) => s.spreads);
  const deposit = useStore((s) => s.settings.depositUsd);
  const setDeposit = useStore((s) => s.setDeposit);

  const stats = React.useMemo(() => {
    const open = spreads.filter((p) => !p.closedAt);
    const count = open.length;
    // MaxLoss (only for verticals with same expiry)
    const maxLossSum = open.reduce((acc, p) => {
      const vertical = p.short.expiryMs === p.long.expiryMs;
      if (!vertical) return acc;
      const width = Math.abs(p.short.strike - p.long.strike);
      return acc + Math.max(0, width - p.cEnter) * (p.qty ?? 1);
    }, 0);
    const share = deposit > 0 ? (maxLossSum / deposit) * 100 : 0;
    return { count, maxLossSum, share };
  }, [spreads, deposit]);

  return (
    <div>
      <h3>Portfolio</h3>
      <div className="grid">
        <div>
          <div className="muted">Open spreads</div>
          <div>{stats.count}</div>
        </div>
        <div>
          <div className="muted">Total MaxLoss</div>
          <div>${stats.maxLossSum.toFixed(2)}</div>
        </div>
        <div>
          <div className="muted">MaxLoss / Deposit</div>
          <div>{stats.share.toFixed(1)}%</div>
        </div>
        <div style={{gridColumn: '1 / -1'}}>
          <span className="muted">Note: MaxLoss учитывает только вертикальные спреды (одинаковая экспирация).</span>
        </div>
        <label>
          <div className="muted">Deposit (USD)</div>
          <input type="number" min="0" step="100" value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} />
        </label>
      </div>
      <DataBackup />
    </div>
  );
}
