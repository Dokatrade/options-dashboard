import React from 'react';
import { DEFAULT_PORTFOLIO_ID, useStore } from '../store/store';
import { describeStrategy, type StrategyLeg } from '../utils/strategyDetection';
import { PositionView } from './PositionView';
import { buildPositionViewPayload, buildSpreadViewPayload, type ViewPayload } from '../utils/viewPayload';

type Props = {
  portfolioId: string;
  onBack: () => void;
};

type SummaryItem = {
  payload: ViewPayload;
  label: string;
  createdAt: number;
  closedAt?: number;
  type: 'spread' | 'position';
};

const formatDateTime = (value?: number) => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '—';
  }
};

export function PortfolioSummaryReport({ portfolioId, onBack }: Props) {
  const portfolios = useStore((s) => s.portfolios);
  const spreads = useStore((s) => s.spreads);
  const positions = useStore((s) => s.positions);

  const targetPortfolioId = React.useMemo(() => {
    const exists = portfolios.some((p) => p.id === portfolioId);
    return exists ? portfolioId : DEFAULT_PORTFOLIO_ID;
  }, [portfolios, portfolioId]);

  const portfolioName = React.useMemo(() => {
    const meta = portfolios.find((p) => p.id === targetPortfolioId);
    return meta ? meta.name : 'Portfolio';
  }, [portfolios, targetPortfolioId]);

  const matchPortfolio = React.useCallback(
    (id?: string) => (id ?? DEFAULT_PORTFOLIO_ID) === targetPortfolioId,
    [targetPortfolioId],
  );

  const items = React.useMemo<SummaryItem[]>(() => {
    const entries: SummaryItem[] = [];
    spreads
      .filter((spread) => matchPortfolio(spread.portfolioId))
      .filter((spread) => !spread.closedAt)
      .forEach((spread) => {
        const qty = Number(spread.qty) > 0 ? Number(spread.qty) : 1;
        const legs: StrategyLeg[] = [
          { side: 'short', type: spread.short.optionType, expiryMs: Number(spread.short.expiryMs) || 0, strike: Number(spread.short.strike) || 0, qty, symbol: spread.short.symbol },
          { side: 'long', type: spread.long.optionType, expiryMs: Number(spread.long.expiryMs) || 0, strike: Number(spread.long.strike) || 0, qty, symbol: spread.long.symbol },
        ];
      const label = describeStrategy(legs, Number(spread.cEnter) || 0);
      const payload = buildSpreadViewPayload(spread, label);
      entries.push({
        payload,
        label,
        createdAt: Number(spread.createdAt) || Date.now(),
        closedAt: spread.closedAt,
        type: 'spread',
      });
    });
    positions
      .filter((position) => matchPortfolio(position.portfolioId))
      .filter((position) => !position.closedAt)
      .forEach((position) => {
        const legs = Array.isArray(position.legs) ? position.legs.filter((leg) => !leg.hidden) : [];
        if (!legs.length) return;
        const strategyLegs: StrategyLeg[] = legs.map((leg) => ({
          side: leg.side,
          type: leg.leg.optionType,
        expiryMs: Number(leg.leg.expiryMs) || 0,
        strike: Number(leg.leg.strike) || 0,
        qty: Number(leg.qty) || 1,
        symbol: leg.leg.symbol,
        isUnderlying: !String(leg.leg.symbol || '').includes('-') || !(Number(leg.leg.expiryMs) > 0),
      }));
      const label = describeStrategy(strategyLegs, 0);
      const payload = buildPositionViewPayload(position, label);
      entries.push({
        payload,
        label,
        createdAt: Number(position.createdAt) || Date.now(),
        closedAt: position.closedAt,
        type: 'position',
      });
    });
    entries.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return entries;
  }, [matchPortfolio, positions, spreads]);

  return (
    <div style={{ padding: '12px 0 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <button className="ghost" onClick={onBack}>Back</button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ margin: 0 }}>Summary · {portfolioName}</h2>
          <div className="muted" style={{ fontSize: '0.9em' }}>Open constructions {items.length}</div>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="muted">Открытых конструкций нет — summary пуст.</div>
      ) : (
        items.map((item) => {
          const created = formatDateTime(item.createdAt);
              return (
                <section key={item.payload.id} style={{ marginBottom: 32 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{item.label}</div>
                      <div className="muted" style={{ fontSize: '0.85em' }}>
                        Created {created} · Open
                      </div>
                    </div>
                    <div className="muted" style={{ fontSize: '0.85em', textTransform: 'uppercase' }}>{item.type}</div>
                  </div>
                  <PositionView {...item.payload} onClose={() => {}} variant="summary" />
            </section>
          );
        })
      )}
    </div>
  );
}
