import React from 'react';
import { useStore } from '../store/store';

export function DataBackup() {
  const spreads = useStore((s) => s.spreads);
  const positions = useStore((s) => s.positions);
  const settings = useStore((s) => s.settings);
  const importState = useStore((s) => s.importState);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const exportJson = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      spreads,
      positions,
      settings,
    };
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = URL.createObjectURL(blob);
    a.download = `options-dashboard-${ts}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onPick = () => inputRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setMsg(null); setErr(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = importState({ spreads: data?.spreads, settings: data?.settings });
      if (!res.ok) throw new Error(res.error || 'Import failed');
      setMsg('Import completed');
    } catch (ex: any) {
      setErr(ex?.message || 'Invalid file');
    }
  };

  return (
    <div style={{marginTop: 12}}>
      <div className="muted" style={{marginBottom: 6}}>Backup</div>
      <div style={{display:'flex', gap: 8, flexWrap:'wrap'}}>
        <button className="ghost" onClick={exportJson}>Export JSON</button>
        <button className="ghost" onClick={onPick}>Import JSON</button>
        <input ref={inputRef} type="file" accept="application/json" style={{display:'none'}} onChange={onFile} />
        {msg && <span className="muted">{msg}</span>}
        {err && <span style={{color:'#c62828'}}>{err}</span>}
      </div>
    </div>
  );
}
