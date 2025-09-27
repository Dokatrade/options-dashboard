import React from 'react';
import { midPrice } from '../../services/bybit';
import type { DraftLeg } from './types';

type DraftTableProps = {
  draft: DraftLeg[];
  tickers: Record<string, any>;
  canSaveAsVertical: boolean;
  totalCreditPer: number;
  onRemoveLeg: (index: number) => void;
  onUpdateQty: (index: number, qty: number) => void;
  onClearDraft: () => void;
  onSave: () => void;
};

const formatPrice = (value?: number) => {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${value.toFixed(2)}`;
};

export function DraftTable({
  draft,
  tickers,
  canSaveAsVertical,
  totalCreditPer,
  onRemoveLeg,
  onUpdateQty,
  onClearDraft,
  onSave,
}: DraftTableProps) {
  const badgeClass = totalCreditPer >= 0 ? 'credit' : 'debit';
  return (
    <div className="draft-panel">
      <div className="draft-panel__header">
        <div>
          <div className="muted">Position builder</div>
          {draft.length === 0 && <div className="muted">No legs added yet.</div>}
        </div>
        <button type="button" className="ghost" onClick={onClearDraft} disabled={!draft.length}>Clear draft</button>
      </div>
      {draft.length > 0 && (
        <div className="draft-panel__table">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Expiry</th>
                <th>Strike</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Mid now</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((d, idx) => {
                const t = tickers[d.leg.symbol];
                const m = midPrice(t);
                const isPerp = !d.leg.symbol.includes('-');
                return (
                  <tr key={`${d.leg.symbol}-${idx}`}>
                    <td>
                      <span className={isPerp ? 'badge perp' : 'badge option'}>
                        {isPerp ? 'PERP' : d.leg.optionType}
                      </span>
                    </td>
                    <td>{isPerp ? '—' : new Date(d.leg.expiryMs).toISOString().slice(0,10)}</td>
                    <td>{isPerp ? '—' : d.leg.strike}</td>
                    <td className={d.side === 'short' ? 'short' : 'long'}>{d.side}</td>
                    <td>
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={d.qty}
                        onChange={(e) => onUpdateQty(idx, Math.max(0.1, Number(e.target.value) || d.qty))}
                        style={{ width: 70 }}
                      />
                    </td>
                    <td>{formatPrice(m)}</td>
                    <td>
                      <button className="ghost" onClick={() => onRemoveLeg(idx)}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="draft-panel__footer">
        <div className={`draft-panel__net ${badgeClass}`}>
          Net {totalCreditPer >= 0 ? 'credit' : 'debit'} (mid, total): {draft.length ? formatPrice(Math.abs(totalCreditPer)) : '—'}
        </div>
        <div className="draft-panel__actions">
          {!canSaveAsVertical && draft.length > 0 && (
            <div className="muted">
              Save to main table supports 2 legs with same expiry, equal qty, opposite sides.
            </div>
          )}
          <button type="button" className="primary" disabled={!draft.length} onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
