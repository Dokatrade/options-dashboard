import React from 'react';
import type { ChainRow } from './types';

type SelectionPanelProps = {
  selectedRow?: ChainRow;
  qty: number;
  onQtyChange: (value: number) => void;
  onAddLeg: (side: 'short' | 'long') => void;
  onAddPerp: (side: 'short' | 'long') => void;
  onClearSelection: () => void;
};

const formatPrice = (value?: number) => {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${value.toFixed(2)}`;
};

export function SelectionPanel({ selectedRow, qty, onQtyChange, onAddLeg, onAddPerp, onClearSelection }: SelectionPanelProps) {
  const disabled = !selectedRow;

  return (
    <div className="selection-panel">
      <div className="selection-panel__header">
        <div className="muted">Selected contract</div>
        {selectedRow ? (
          <button type="button" className="ghost" onClick={onClearSelection}>Clear selection</button>
        ) : (
          <span className="muted">Pick a row in the chain</span>
        )}
      </div>
      {selectedRow ? (
        <div className="selection-panel__body">
          <div className="selection-panel__contract">
            <div className="selection-panel__strike">{selectedRow.strike}</div>
            <div className="selection-panel__meta">
              <span>{selectedRow.optionType === 'P' ? 'PUT' : 'CALL'}</span>
              <span>{new Date(selectedRow.expiryMs).toISOString().slice(0,10)}</span>
            </div>
          </div>
          <div className="selection-panel__stats">
            <div>
              <span className="muted">Bid</span>
              <span>{formatPrice(selectedRow.bid)}</span>
            </div>
            <div>
              <span className="muted">Ask</span>
              <span>{formatPrice(selectedRow.ask)}</span>
            </div>
            <div>
              <span className="muted">Mid</span>
              <span>{formatPrice(selectedRow.mid)}</span>
            </div>
            <div>
              <span className="muted">Δ</span>
              <span>{selectedRow.delta != null ? selectedRow.delta.toFixed(2) : '—'}</span>
            </div>
            <div>
              <span className="muted">OI</span>
              <span>{selectedRow.openInterest != null ? selectedRow.openInterest : '—'}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="selection-panel__placeholder muted">
          Select an option from the chain to preview pricing and add a leg.
        </div>
      )}
      <div className="selection-panel__actions">
        <label>
          <div className="muted">Volume (qty)</div>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={qty}
            onChange={(e) => onQtyChange(Math.max(0.1, Number(e.target.value) || 0.1))}
          />
        </label>
        <div className="selection-panel__buttons">
          <button type="button" className="ghost short" disabled={disabled} onClick={() => onAddLeg('short')}>Add Short</button>
          <button type="button" className="ghost long" disabled={disabled} onClick={() => onAddLeg('long')}>Add Long</button>
          <span className="muted">or</span>
          <button type="button" className="ghost short" onClick={() => onAddPerp('short')}>Add Perp Short (ETHUSDT)</button>
          <button type="button" className="ghost long" onClick={() => onAddPerp('long')}>Add Perp Long (ETHUSDT)</button>
        </div>
      </div>
    </div>
  );
}
