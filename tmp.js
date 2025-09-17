const legOptions = [{ symbol: 'LEG1', label: 'Leg 1' }, { symbol: 'LEG2', label: 'Leg 2' }];

const sanitizeLegSymbol = (symbol, legOptions) => {
  if (!symbol) return undefined;
  return legOptions.some((opt) => opt.symbol === symbol) ? symbol : undefined;
};
const createOperand = (kind, ctx) => {
  if (kind === 'number') return { kind: 'number', value: 0 };
  if (kind === 'position') return { kind: 'position', metric: 'spot' };
  if (kind === 'leg') {
    const legMode = ctx.scope === 'leg' ? 'current' : 'symbol';
    const symbol = ctx.scope === 'leg' ? ctx.chainLegSymbol : ctx.legOptions[0]?.symbol;
    return { kind: 'leg', metric: 'spot', legMode, symbol: legMode === 'symbol' ? sanitizeLegSymbol(symbol, ctx.legOptions) : undefined };
  }
};
const sanitizeOperand = (input, ctx) => {
  if (input?.kind === 'number') {
    const value = Number(input.value);
    return { kind: 'number', value: Number.isFinite(value) ? value : 0 };
  }
  if (input?.kind === 'position') {
    const metric = typeof input.metric === 'string' ? input.metric : 'spot';
    return { kind: 'position', metric };
  }
  if (input?.kind === 'leg') {
    const metric = typeof input.metric === 'string' ? input.metric : 'spot';
    let legMode = input.legMode === 'symbol' ? 'symbol' : 'current';
    if (ctx.scope !== 'leg') legMode = 'symbol';
    const symbol = sanitizeLegSymbol(input.symbol, ctx.legOptions);
    if (legMode === 'symbol' && !symbol) {
      const fallback = ctx.legOptions[0]?.symbol;
      return { kind: 'leg', metric, legMode: 'symbol', symbol: fallback };
    }
    if (legMode === 'current') {
      return { kind: 'leg', metric, legMode: 'current', symbol: undefined };
    }
    return { kind: 'leg', metric, legMode: 'symbol', symbol };
  }
  return createOperand(ctx.scope === 'leg' ? 'leg' : 'position', ctx);
};
const sanitizeSide = (input, ctx) => {
  const base = sanitizeOperand(input?.base, ctx);
  if (input?.op && input.op.operator && input.op.operand) {
    const operator = ['+','-','*','/'].includes(input.op.operator) ? input.op.operator : '+';
    const operand = sanitizeOperand(input.op.operand, ctx);
    return { base, op: { operator, operand } };
  }
  return { base };
};
const sanitizeCond = (cond, ctx) => ({
  left: sanitizeSide(cond?.left, ctx),
  cmp: ['>','<','=','>=','<='].includes(cond?.cmp) ? cond?.cmp : '>',
  right: sanitizeSide(cond?.right, ctx),
});
const defaultCond = (ctx) => ({
  left: { base: sanitizeOperand({ kind: ctx.scope === 'leg' ? 'leg' : 'position', metric: 'spot', legMode: 'current' }, ctx) },
  cmp: '>',
  right: { base: { kind: 'number', value: 0 } },
});
const sanitizeChain = (chain, ctx) => {
  const scope = chain?.scope === 'position' ? 'position' : 'leg';
  const scopedCtx = { ...ctx, scope, chainLegSymbol: sanitizeLegSymbol(chain?.legSymbol, ctx.legOptions) };
  const rawConds = Array.isArray(chain?.conds) ? chain.conds : undefined;
  const conds = rawConds !== undefined ? rawConds : [ { cond: defaultCond(scopedCtx) } ];
  return {
    scope,
    legSymbol: scopedCtx.chainLegSymbol,
    conds: conds.map((item, idx) => ({
      conj: idx === 0 ? undefined : (item?.conj === 'OR' ? 'OR' : 'AND'),
      cond: sanitizeCond(item?.cond ?? item, scopedCtx),
    })),
  };
};
const inferLegSymbolFromCond = (cond) => {
  const legSymbolFromOperand = (operand) => {
    if (operand.kind === 'leg' && operand.legMode === 'symbol' && operand.symbol) {
      return operand.symbol;
    }
  };
  const legSymbolFromSide = (side) => legSymbolFromOperand(side.base) || (side.op ? legSymbolFromOperand(side.op.operand) : undefined);
  return legSymbolFromSide(cond.left) || legSymbolFromSide(cond.right);
};

const makeDefaultChain = (scope, legSymbol) => {
  const ctx = { scope, chainLegSymbol: legSymbol, legOptions };
  const raw = { scope, legSymbol, conds: [ { cond: defaultCond(ctx) } ] };
  return sanitizeChain(raw, ctx);
};

const chain = makeDefaultChain('leg', undefined);
console.log('default chain', chain);
const baseChain = { ...chain, conds: [] };
const ctx = { scope: baseChain.scope, chainLegSymbol: baseChain.legSymbol, legOptions };
const cond = sanitizeCond(chain.conds[0].cond, ctx);
console.log('cond', cond);
let legSymbol = baseChain.legSymbol;
if (baseChain.scope === 'leg' && !legSymbol) {
  legSymbol = inferLegSymbolFromCond(cond) ?? legSymbol;
}
console.log('inferred legSymbol', legSymbol);
