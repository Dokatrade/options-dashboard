import React from 'react';

export type IfComparator = '>' | '<' | '=' | '>=' | '<=';
export type IfCond = { param: string; cmp: IfComparator; value: number };
export type IfChain = { scope: 'position' | 'leg'; legSymbol?: string; conds: Array<{ conj?: 'AND' | 'OR'; cond: IfCond }> };
export type IfRule = { chains: Array<{ conj?: 'AND' | 'OR'; chain: IfChain }> };

type Props = {
  title: string;
  legOptions: Array<{ symbol: string; label: string }>;
  initial?: IfRule;
  onSave: (rule: IfRule) => void;
  onClose: () => void;
  evalCondLive?: (args: { scope: 'position'|'leg'; legSymbol?: string; cond: IfCond }) => boolean;
};

const posParams: Array<{ value: string; label: string }> = [
  { value: 'spot', label: 'Spot' },
  { value: 'netEntry', label: 'Net entry' },
  { value: 'netMid', label: 'Net mid' },
  { value: 'pnl', label: 'PnL ($)' },
  { value: 'pnlPctMax', label: 'PnL % of Max Profit' },
  { value: 'delta', label: 'Δ (sum)' },
  { value: 'vega', label: 'Vega (sum)' },
  { value: 'theta', label: 'Θ (sum)' },
  { value: 'dte', label: 'DTE (days)' },
];

const legParams: Array<{ value: string; label: string }> = [
  { value: 'spot', label: 'Spot' },
  { value: 'bid', label: 'Bid' },
  { value: 'ask', label: 'Ask' },
  { value: 'mid', label: 'Mid' },
  { value: 'entry', label: 'Entry' },
  { value: 'pnlLeg', label: 'PnL ($)' },
  { value: 'ivPct', label: 'IV %' },
  { value: 'vega', label: 'Vega' },
  { value: 'delta', label: 'Δ (Delta)' },
  { value: 'theta', label: 'Θ (Theta)' },
  { value: 'oi', label: 'OI (Ctrs)' },
  { value: 'dSigma', label: 'Δσ (Vol)' },
];

export function IfModal({ title, legOptions, initial, onSave, onClose, evalCondLive }: Props) {
  const [rule, setRule] = React.useState<IfRule>(() => initial ?? ({ chains: [ { chain: { scope: 'leg', conds: [ { cond: { param: 'delta', cmp: '>', value: 0.25 } } ] } } ] }));

  const updateChain = (idx: number, next: IfChain) => {
    setRule((r) => ({ chains: r.chains.map((c, i) => i === idx ? { ...c, chain: next } : c) }));
  };
  const updateChainConj = (idx: number, conj?: 'AND'|'OR') => {
    setRule((r) => ({ chains: r.chains.map((c, i) => i === idx ? { ...c, conj } : c) }));
  };
  const addChain = () => setRule((r) => ({ chains: [...r.chains, { conj: 'AND', chain: { scope: 'leg', conds: [ { cond: { param: 'pnlLeg', cmp: '>', value: 0 } } ] } }] }));
  const removeChain = (idx: number) => setRule((r) => ({ chains: r.chains.filter((_, i) => i !== idx) }));

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:75, display:'flex', alignItems:'center', justifyContent:'center'}}>
      <div style={{background:'var(--card)', color:'var(--fg)', border:'1px solid var(--border)', borderRadius:12, width:860, maxWidth:'95%', maxHeight:'85%', overflow:'auto', boxShadow:'0 10px 24px rgba(0,0,0,.35)'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--border)'}}>
          <strong>IF · {title}</strong>
          <div style={{display:'flex', gap:8}}>
            <button className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>
        <div style={{padding:12}}>
          <div className="muted" style={{marginBottom:8}}>Добавьте одно или несколько условий. Для «Leg» все условия внутри блока применяются к одной и той же ноге.</div>
          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            {rule.chains.map((C, idx) => {
              const chain = C.chain;
              return (
                <div key={idx} style={{border:'1px solid var(--border)', borderRadius:8, padding:8}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
                    {idx > 0 && (
                      <select value={C.conj || 'AND'} onChange={(e)=>updateChainConj(idx, e.target.value as any)}>
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                    )}
                    <span className="muted">Scope</span>
                    <select value={chain.scope} onChange={(e)=>updateChain(idx, { ...chain, scope: e.target.value as any })}>
                      <option value="position">Position</option>
                      <option value="leg">Leg (same)</option>
                    </select>
                    {chain.scope === 'leg' && (
                      <>
                        <span className="muted">Leg</span>
                        <select value={chain.legSymbol || ''} onChange={(e)=>updateChain(idx, { ...chain, legSymbol: e.target.value || undefined })}>
                          <option value="">Any</option>
                          {legOptions.map((opt) => (
                            <option key={opt.symbol} value={opt.symbol}>{opt.label}</option>
                          ))}
                        </select>
                      </>
                    )}
                    <div style={{marginLeft:'auto'}}>
                      <button className="ghost" onClick={()=>removeChain(idx)}>Remove block</button>
                    </div>
                  </div>
                  <div style={{display:'flex', flexDirection:'column', gap:6}}>
                    {chain.conds.map((ci, jdx) => {
                      const done = evalCondLive ? evalCondLive({ scope: chain.scope, legSymbol: chain.legSymbol, cond: ci.cond }) : false;
                      return (
                      <div key={jdx} style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                        {jdx > 0 && (
                          <select value={ci.conj || 'AND'} onChange={(e)=>{
                            const next = { ...chain, conds: chain.conds.map((x,k)=> k===jdx ? { ...x, conj: e.target.value as any } : x) };
                            updateChain(idx, next);
                          }}>
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                        )}
                        <select value={ci.cond.param} onChange={(e)=>{
                          const next = { ...chain, conds: chain.conds.map((x,k)=> k===jdx ? { ...x, cond: { ...x.cond, param: e.target.value } } : x) };
                          updateChain(idx, next);
                        }}>
                          {(chain.scope === 'position' ? posParams : legParams).map((p)=> (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        <select value={ci.cond.cmp} onChange={(e)=>{
                          const next = { ...chain, conds: chain.conds.map((x,k)=> k===jdx ? { ...x, cond: { ...x.cond, cmp: e.target.value as IfComparator } } : x) };
                          updateChain(idx, next);
                        }}>
                          <option value=">">&gt;</option>
                          <option value="<">&lt;</option>
                          <option value="=">=</option>
                          <option value=">=">≥</option>
                          <option value="<=">≤</option>
                        </select>
                        <input type="number" value={ci.cond.value} onChange={(e)=>{
                          const next = { ...chain, conds: chain.conds.map((x,k)=> k===jdx ? { ...x, cond: { ...x.cond, value: Number(e.target.value) } } : x) };
                          updateChain(idx, next);
                        }} style={{width:120}} />
                        {done && (
                          <span style={{color:'#0a0', fontWeight:700, fontSize:'calc(1em + 4px)', letterSpacing:1}}>DONE</span>
                        )}
                        <button className="ghost" onClick={()=>{
                          const next = { ...chain, conds: chain.conds.filter((_,k)=>k!==jdx) };
                          updateChain(idx, next);
                        }}>Remove</button>
                      </div>
                    );})}
                    <div>
                      <button className="ghost" onClick={()=>{
                        const baseParams = chain.scope === 'position' ? posParams : legParams;
                        const def = baseParams[0]?.value || (chain.scope === 'position' ? 'spot' : 'mid');
                        const next = { ...chain, conds: [...chain.conds, { conj: 'AND', cond: { param: def, cmp: '>', value: 0 } }] };
                        updateChain(idx, next);
                      }}>+ Add condition</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{display:'flex', alignItems:'center', gap:8, marginTop:10}}>
            <button className="ghost" onClick={addChain}>+ Add block</button>
            <div style={{marginLeft:'auto', display:'flex', gap:8}}>
              <button className="ghost" onClick={onClose}>Cancel</button>
              <button className="primary" onClick={()=>onSave(rule)}>Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
