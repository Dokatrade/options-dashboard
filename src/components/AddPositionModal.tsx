import React from 'react';
import { AddPosition } from './AddPosition';

type Props = {
  onClose: () => void;
};

export function AddPositionModal({ onClose }: Props) {
  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 70,
        padding: '16px',
      }}
      role="dialog"
      aria-modal
    >
      <div
        style={{
          background: 'var(--card)',
          color: 'var(--fg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          width: 'min(1040px, 100%)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 16px 40px rgba(0,0,0,.35)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 16px 4px' }}>
          <button className="ghost" onClick={onClose} aria-label="Close add position">Close</button>
        </div>
        <div style={{ padding: '0 16px 16px', overflow: 'auto' }}>
          <AddPosition />
        </div>
      </div>
    </div>
  );
}
