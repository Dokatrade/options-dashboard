import React from 'react';
import type { OptionType } from '../../utils/types';

const formatSpot = (price?: number) => {
  if (price == null || Number.isNaN(price)) return '—';
  return `$${price.toFixed(2)}`;
};

const dteFrom = (ms: number) => {
  return Math.max(0, Math.round((ms - Date.now()) / (1000 * 60 * 60 * 24)));
};

type FiltersPanelProps = {
  optType: OptionType;
  expiry: number | '';
  expiries: number[];
  deltaMin: number;
  deltaMax: number;
  minOI: number;
  maxSpread: number;
  showAllStrikes: boolean;
  loading: boolean;
  slowMode: boolean;
  spotPrice?: number;
  onTypeChange: (type: OptionType) => void;
  onExpiryChange: (expiry: number | '') => void;
  onDeltaMinChange: (value: number) => void;
  onDeltaMaxChange: (value: number) => void;
  onMinOiChange: (value: number) => void;
  onMaxSpreadChange: (value: number) => void;
  onToggleShowAll: (value: boolean) => void;
};

export function FiltersPanel({
  optType,
  expiry,
  expiries,
  deltaMin,
  deltaMax,
  minOI,
  maxSpread,
  showAllStrikes,
  loading,
  slowMode,
  spotPrice,
  onTypeChange,
  onExpiryChange,
  onDeltaMinChange,
  onDeltaMaxChange,
  onMinOiChange,
  onMaxSpreadChange,
  onToggleShowAll,
}: FiltersPanelProps) {
  return (
    <div className="add-position__filters">
      <div className="add-position__filters-row">
        <div className="add-position__field">
          <div className="muted add-position__label">Type</div>
          <div className="add-position__segmented">
            <button
              type="button"
              className={optType === 'P' ? 'segmented active' : 'segmented'}
              onClick={() => onTypeChange('P')}
            >
              PUT
            </button>
            <button
              type="button"
              className={optType === 'C' ? 'segmented active' : 'segmented'}
              onClick={() => onTypeChange('C')}
            >
              CALL
            </button>
          </div>
        </div>
        <label className="add-position__field">
          <div className="muted add-position__label">Expiry</div>
          <select value={expiry} onChange={(e) => {
            const v = e.target.value;
            onExpiryChange(v === '' ? '' : Number(v));
          }} disabled={loading}>
            <option value="">Select expiry</option>
            {expiries.map((ms) => (
              <option key={ms} value={ms}>
                {new Date(ms).toISOString().slice(0,10)} · {dteFrom(ms)}d
              </option>
            ))}
          </select>
        </label>
        <label className="add-position__toggle">
          <input type="checkbox" checked={showAllStrikes} onChange={(e) => onToggleShowAll(e.target.checked)} />
          <span className="muted">Show all strikes</span>
        </label>
        <div className="add-position__status">
          <span className="muted">Spot ETH</span>
          <span className="add-position__spot">{formatSpot(spotPrice)}</span>
          {slowMode && <span className="add-position__badge">Slow mode</span>}
        </div>
      </div>
      <div className="add-position__filters-row">
        <div className="add-position__field">
          <div className="muted add-position__label">Δ range</div>
          <div className="add-position__range">
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={deltaMin}
              onChange={(e) => onDeltaMinChange(Number(e.target.value))}
            />
            <span className="muted">to</span>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={deltaMax}
              onChange={(e) => onDeltaMaxChange(Number(e.target.value))}
            />
          </div>
        </div>
        <label className="add-position__field">
          <div className="muted add-position__label">Min OI</div>
          <input type="number" min={0} step={1} value={minOI} onChange={(e) => onMinOiChange(Number(e.target.value) || 0)} />
        </label>
        <label className="add-position__field">
          <div className="muted add-position__label">Max spread ($)</div>
          <input type="number" min={0} step={0.01} value={Math.max(0, maxSpread)} onChange={(e) => onMaxSpreadChange(Number(e.target.value) || 0)} />
        </label>
      </div>
    </div>
  );
}
