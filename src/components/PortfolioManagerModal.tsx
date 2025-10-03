import React from 'react';
import { useStore, DEFAULT_PORTFOLIO_ID } from '../store/store';

type Props = {
  onClose: () => void;
};

export function PortfolioManagerModal({ onClose }: Props) {
  const portfolios = useStore((s) => s.portfolios);
  const spreads = useStore((s) => s.spreads);
  const positions = useStore((s) => s.positions);
  const activePortfolioId = useStore((s) => s.activePortfolioId);
  const setActivePortfolio = useStore((s) => s.setActivePortfolio);
  const deletePortfolio = useStore((s) => s.deletePortfolio);
  const renamePortfolio = useStore((s) => s.renamePortfolio);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState('');
  const [editingError, setEditingError] = React.useState<string | null>(null);

  const stats = React.useMemo(() => {
    const countMap = new Map<string, { spreads: number; positions: number }>();
    const inc = (id: string, key: 'spreads' | 'positions') => {
      const entry = countMap.get(id) ?? { spreads: 0, positions: 0 };
      entry[key] += 1;
      countMap.set(id, entry);
    };
    spreads.forEach((spread) => {
      const pid = spread.portfolioId ?? DEFAULT_PORTFOLIO_ID;
      inc(pid, 'spreads');
    });
    positions.forEach((position) => {
      const pid = position.portfolioId ?? DEFAULT_PORTFOLIO_ID;
      inc(pid, 'positions');
    });
    const totalPositions = positions.length + spreads.length;
    countMap.set(DEFAULT_PORTFOLIO_ID, { spreads: 0, positions: totalPositions });
    return portfolios.map((meta) => {
      const entry = countMap.get(meta.id) ?? { spreads: 0, positions: 0 };
      return {
        ...meta,
        itemCount: entry.positions + entry.spreads,
      };
    });
  }, [portfolios, positions, spreads]);

  const handleDelete = React.useCallback((id: string, total: number) => {
    if (id === DEFAULT_PORTFOLIO_ID) return;
    const message = total > 0
      ? `Delete this portfolio? ${total} constructions will move to Default.`
      : 'Delete this empty portfolio?';
    if (!window.confirm(message)) return;
    deletePortfolio(id);
  }, [deletePortfolio]);

  const beginEdit = React.useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
    setEditingError(null);
  }, []);

  const cancelEdit = React.useCallback(() => {
    setEditingId(null);
    setEditingName('');
    setEditingError(null);
  }, []);

  const submitEdit = React.useCallback(() => {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingError('Введите название');
      return;
    }
    if (portfolios.some((p) => p.id !== editingId && p.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setEditingError('Портфель с таким названием уже существует');
      return;
    }
    renamePortfolio(editingId, trimmed);
    cancelEdit();
  }, [cancelEdit, editingId, editingName, renamePortfolio, portfolios]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 120,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)',
          color: 'var(--fg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          width: 'min(520px, 90%)',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 10px 30px rgba(0,0,0,.35)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <strong>Manage portfolios</strong>
              <button className="ghost" onClick={onClose}>Close</button>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="muted" style={{ fontSize: '0.9em' }}>Deleting a portfolio moves its positions and spreads to <strong>Default</strong>.</div>
              {stats.map((meta) => {
                const total = meta.itemCount;
                const isDefault = meta.id === DEFAULT_PORTFOLIO_ID;
                const isActive = meta.id === activePortfolioId;
                const isEditing = editingId === meta.id;
                return (
                  <div
                    key={meta.id}
                    style={{
                      display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                      background: isActive ? 'rgba(64, 64, 64, 0.15)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 auto' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => {
                              setEditingName(e.target.value);
                              if (editingError) setEditingError(null);
                            }}
                            maxLength={64}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                submitEdit();
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEdit();
                              }
                            }}
                          />
                          {editingError && <span style={{ color: 'var(--loss)', fontSize: '0.85em' }}>{editingError}</span>}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="primary" onClick={submitEdit}>Save</button>
                            <button className="ghost" onClick={cancelEdit}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <strong>{meta.name}</strong>
                            {isActive && <span className="muted" style={{ fontSize: '0.85em' }}>(active)</span>}
                          </div>
                          <div className="muted" style={{ fontSize: '0.85em' }}>
                            Positions {total}
                          </div>
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {!isActive && !isEditing && (
                        <button className="ghost" onClick={() => setActivePortfolio(meta.id)}>Set active</button>
                      )}
                      {isDefault ? (
                        <span className="muted" style={{ fontSize: '0.85em' }}>Default</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {!isEditing && (
                            <button className="ghost" onClick={() => beginEdit(meta.id, meta.name)}>Edit</button>
                          )}
                          <button
                            className="ghost"
                            onClick={() => handleDelete(meta.id, total)}
                            aria-label={`Delete portfolio ${meta.name}`}
                            style={{ color: 'var(--loss)' }}
                          >×</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
        </div>
      </div>
    </div>
  );
}
