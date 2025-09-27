import React from 'react';
import type { ChainRow } from './types';

const formatNumber = (value?: number, digits = 2) => {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
};

const formatPrice = (value?: number) => {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${value.toFixed(2)}`;
};

type OptionChainTableProps = {
  rows: ChainRow[];
  loading: boolean;
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
  emptyMessage?: string;
};

export function OptionChainTable({ rows, loading, selectedSymbol, onSelect, emptyMessage }: OptionChainTableProps) {
  const tableRef = React.useRef<HTMLTableSectionElement | null>(null);
  const [hoveredSymbol, setHoveredSymbol] = React.useState<string>('');

  React.useEffect(() => {
    setHoveredSymbol('');
  }, [rows]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!rows.length) return;
    const index = rows.findIndex((row) => row.symbol === selectedSymbol);
    let nextIndex = index;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      nextIndex = index >= 0 ? Math.min(rows.length - 1, index + 1) : 0;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      nextIndex = index >= 0 ? Math.max(0, index - 1) : rows.length - 1;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      nextIndex = 0;
    }
    if (event.key === 'End') {
      event.preventDefault();
      nextIndex = rows.length - 1;
    }
    if (nextIndex !== index) {
      onSelect(rows[nextIndex].symbol);
      const el = tableRef.current?.querySelector<HTMLTableRowElement>(`[data-symbol="${rows[nextIndex].symbol}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter' && index >= 0) {
      onSelect(rows[index].symbol);
    }
  };

  const hasMultipleExpiries = React.useMemo(() => {
    const expiries = new Set(rows.map((row) => row.expiryMs));
    return expiries.size > 1;
  }, [rows]);

  return (
    <div className="option-chain">
      <div className="option-chain__header">
        <div className="muted">Option chain ({rows.length})</div>
        {loading && <div className="muted">Loading…</div>}
      </div>
      <div className="option-chain__table" tabIndex={0} onKeyDown={handleKeyDown}>
        {rows.length === 0 && !loading && (
          <div className="option-chain__empty muted">
            {emptyMessage || 'No strikes match filters. Adjust Δ range or toggle “Show all strikes”.'}
          </div>
        )}
        <table>
          <thead>
            <tr>
              <th>Strike</th>
              <th>Bid</th>
              <th>Ask</th>
              <th>Mid</th>
              <th>Δ</th>
              <th>OI</th>
              <th>Spread</th>
              {hasMultipleExpiries && <th>Expiry</th>}
            </tr>
          </thead>
          <tbody ref={tableRef}>
            {rows.map((row) => {
              const isSelected = row.symbol === selectedSymbol;
              const isHovered = row.symbol === hoveredSymbol;
              const className = [
                isSelected ? 'selected' : '',
                isHovered ? 'hovered' : '',
              ].filter(Boolean).join(' ');
              return (
                <tr
                  key={row.symbol}
                  data-symbol={row.symbol}
                  className={className}
                  onMouseEnter={() => setHoveredSymbol(row.symbol)}
                  onMouseLeave={() => setHoveredSymbol('')}
                  onClick={() => onSelect(row.symbol)}
                >
                  <td>{row.strike}</td>
                  <td>{formatPrice(row.bid)}</td>
                  <td>{formatPrice(row.ask)}</td>
                  <td>{formatPrice(row.mid)}</td>
                  <td>{formatNumber(row.delta)}</td>
                  <td>{row.openInterest != null ? row.openInterest : '—'}</td>
                  <td>{row.spread != null ? `$${row.spread.toFixed(2)}` : '—'}</td>
                  {hasMultipleExpiries && <td>{new Date(row.expiryMs).toISOString().slice(0,10)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
