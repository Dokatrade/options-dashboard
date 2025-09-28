import React from 'react';
import { useStore } from '../store/store';

export function PortfolioSummary() {
  const spreads = useStore((s) => s.spreads);
  const positions = useStore((s) => s.positions);
  const deposit = useStore((s) => s.settings.depositUsd);
  const setDeposit = useStore((s) => s.setDeposit);

  const toNumber = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const metrics = React.useMemo(() => {
    const now = Date.now();

    // Open/Closed counts (spreads + positions)
    const openSpreads = spreads.filter((p) => !p.closedAt).length;
    const closedSpreads = spreads.filter((p) => p.closedAt != null).length;
    const openPositions = positions.filter((p) => !p.closedAt).length;
    const closedPositions = positions.filter((p) => p.closedAt != null).length;
    const openCount = openSpreads + openPositions;
    const closedCount = closedSpreads + closedPositions;

    // Open Risk = sum MaxLoss for OPEN vertical spreads only
    const openVerticals = spreads.filter((p) => !p.closedAt && p.short.expiryMs === p.long.expiryMs);
    const openRisk = openVerticals.reduce((acc, p) => {
      const width = Math.abs(Number(p.short.strike) - Number(p.long.strike));
      const qty = Number(p.qty) > 0 ? Number(p.qty) : 1;
      const ml = Math.max(0, width - Number(p.cEnter)) * qty;
      return acc + (Number.isFinite(ml) ? ml : 0);
    }, 0);
    const riskShare = deposit > 0 ? (openRisk / deposit) * 100 : 0;

    // Realized PnL (sum of closeSnapshot.pnlExec for closed items)
    const realizedFromSpreads = spreads.reduce((acc, p) => acc + (toNumber(p?.closeSnapshot?.pnlExec) ?? 0), 0);
    const realizedFromPositions = positions.reduce((acc, p) => acc + (toNumber(p?.closeSnapshot?.pnlExec) ?? 0), 0);
    const realized = realizedFromSpreads + realizedFromPositions;

    // Unsettled (expired expiries without settlement), both spreads and positions
    const countUnsettledForSpread = (p: typeof spreads[number]) => {
      const expiries = new Set<number>();
      [p.short, p.long].forEach((leg) => {
        const symbol = String(leg?.symbol || '');
        const expiryMs = Number(leg?.expiryMs) || 0;
        if (!symbol.includes('-')) return; // only options
        if (expiryMs > 0 && expiryMs <= now) expiries.add(expiryMs);
      });
      const settlements = p?.settlements ?? {};
      let cnt = 0;
      expiries.forEach((e) => { if (!settlements[String(e)]) cnt++; });
      return cnt;
    };
    const countUnsettledForPosition = (p: typeof positions[number]) => {
      const expiries = new Set<number>();
      (p?.legs || []).forEach((L) => {
        const symbol = String(L?.leg?.symbol || '');
        const expiryMs = Number(L?.leg?.expiryMs) || 0;
        if (!symbol.includes('-')) return; // only options
        if (expiryMs > 0 && expiryMs <= now) expiries.add(expiryMs);
      });
      const settlements = p?.settlements ?? {};
      let cnt = 0;
      expiries.forEach((e) => { if (!settlements[String(e)]) cnt++; });
      return cnt;
    };
    const unsettled = spreads.reduce((acc, p) => acc + countUnsettledForSpread(p), 0)
      + positions.reduce((acc, p) => acc + countUnsettledForPosition(p), 0);

    // Last Exit (latest snapshot by timestamp)
    type Snapshot = { ts: number; pnl?: number; idx?: number; spot?: number };
    const collectSnap = (ts?: number, pnl?: number, idx?: number, spot?: number): Snapshot | null => {
      if (!(Number.isFinite(ts) && ts! > 0)) return null;
      return { ts: ts!, pnl, idx, spot };
    };
    const snaps: Snapshot[] = [];
    spreads.forEach((p) => {
      const s = p?.closeSnapshot;
      const item = collectSnap(toNumber(s?.timestamp), toNumber(s?.pnlExec), toNumber(s?.indexPrice), toNumber(s?.spotPrice));
      if (item) snaps.push(item);
    });
    positions.forEach((p) => {
      const s = p?.closeSnapshot;
      const item = collectSnap(toNumber(s?.timestamp), toNumber(s?.pnlExec), toNumber(s?.indexPrice), toNumber(s?.spotPrice));
      if (item) snaps.push(item);
    });
    snaps.sort((a, b) => b.ts - a.ts);
    const last = snaps[0];

    return {
      openCount,
      closedCount,
      openRisk,
      riskShare,
      realized,
      unsettled,
      last,
    };
  }, [spreads, positions, deposit]);

  const [showManage, setShowManage] = React.useState(false);

  const fmtMoney = (v: number) => `$${(Number.isFinite(v) ? v : 0).toFixed(2)}`;
  const pnlColor = metrics.realized > 0 ? 'var(--gain)' : (metrics.realized < 0 ? 'var(--loss)' : undefined);

  const lastExitLabel = (() => {
    const s = metrics.last;
    if (!s) return '—';
    try {
      const dt = new Date(s.ts);
      const datePart = dt.toLocaleDateString('ru-RU');
      const timePart = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const pnl = s.pnl != null && Number.isFinite(s.pnl) ? `${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}` : '—';
      const idx = s.idx != null && Number.isFinite(s.idx) ? s.idx.toFixed(2) : '—';
      const spot = s.spot != null && Number.isFinite(s.spot) ? s.spot.toFixed(2) : '—';
      return `${datePart} ${timePart} | ${pnl} | Index ${idx} | Spot ${spot}`;
    } catch {
      return '—';
    }
  })();

  return (
    <div>
      <h3>Portfolio</h3>
      <div className="grid" style={{ alignItems: 'end' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="muted">Equity Snapshot</div>
          <div>
            Deposit {fmtMoney(deposit)} · Realized <span style={pnlColor ? { color: pnlColor } : undefined}>{fmtMoney(metrics.realized)}</span> · Risk {fmtMoney(metrics.openRisk)} ({metrics.riskShare.toFixed(1)}%)
          </div>
        </div>
        <div>
          <div className="muted">Open</div>
          <div>{metrics.openCount}</div>
        </div>
        <div>
          <div className="muted">Closed</div>
          <div>{metrics.closedCount}</div>
        </div>
        <div>
          <div className="muted">Unsettled</div>
          <div>{metrics.unsettled}</div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="muted">Last Exit</div>
          <div>{lastExitLabel}</div>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <button className="ghost" onClick={() => setShowManage((v) => !v)}>{showManage ? 'Hide manage' : 'Manage'}</button>
        </div>
        {showManage && (
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, alignItems: 'end', flexWrap: 'wrap' }}>
            <label>
              <div className="muted">Deposit (USD)</div>
              <input type="number" min="0" step="100" value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} />
            </label>
            <div style={{ flexBasis: '100%' }}>
              <span className="muted">Note: Risk учитывает только вертикальные спреды.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
