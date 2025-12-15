import React from 'react';

export type IfComparator = '>' | '<' | '=' | '>=' | '<=';
export type IfArithOp = '+' | '-' | '*' | '/';
export type IfOperand =
  | { kind: 'number'; value: number }
  | { kind: 'position'; metric: string }
  | { kind: 'leg'; metric: string; legMode: 'current' | 'symbol'; symbol?: string };
export type IfSide = { base: IfOperand; op?: { operator: IfArithOp; operand: IfOperand } };
export type IfCond = { left: IfSide; cmp: IfComparator; right: IfSide };
export type IfConditionTemplate = { name: string; scope: 'position' | 'leg'; cond: IfCond; legSymbol?: string | null };
export type IfChain = { scope: 'position' | 'leg'; legSymbol?: string; conds: Array<{ conj?: 'AND' | 'OR'; cond: IfCond }> };
export type IfRule = { chains: Array<{ conj?: 'AND' | 'OR'; chain: IfChain }> };

type Props = {
  title: string;
  legOptions: Array<{ symbol: string; label: string }>;
  initial?: IfRule;
  ruleKey?: string;
  onSave: (rule: IfRule) => void;
  onClose: () => void;
  evalCondLive?: (args: { scope: 'position'|'leg'; legSymbol?: string; cond: IfCond }) => boolean;
  evalCondDetails?: (args: { scope: 'position'|'leg'; legSymbol?: string; cond: IfCond }) => { satisfied: boolean; lhs?: number; rhs?: number } | undefined;
  templates?: IfConditionTemplate[];
  onSaveTemplate?: (tpl: IfConditionTemplate) => void;
  onDeleteTemplate?: (tpl: IfConditionTemplate) => void;
  onDeleteTemplates?: (tpls: IfConditionTemplate[]) => void;
};

const posParams: Array<{ value: string; label: string }> = [
  { value: 'spot', label: 'Perp (ETHUSDT)' },
  { value: 'netEntry', label: 'Net entry' },
  { value: 'netMid', label: 'Net mid' },
  { value: 'kmid', label: 'Kmid (Net mid / Net entry)' },
  { value: 'pnl', label: 'PnL ($)' },
  { value: 'pnlPctMax', label: 'PnL % of Max Profit' },
  { value: 'delta', label: 'Δ (sum)' },
  { value: 'vega', label: 'Vega (sum)' },
  { value: 'theta', label: 'Θ (sum)' },
  { value: 'dte', label: 'DTE (days)' },
];

const legParams: Array<{ value: string; label: string }> = [
  { value: 'spot', label: 'Perp (underlying)' },
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

const defaultPositionMetric = posParams[0]?.value ?? 'spot';
const defaultLegMetric = legParams[0]?.value ?? 'mid';

type ChainCtx = { scope: 'position' | 'leg'; chainLegSymbol?: string; legOptions: Array<{ symbol: string; label: string }> };
type QuickTemplate = { scope: 'position' | 'leg'; label: string; build: (ctx: ChainCtx) => IfCond; legSymbol?: string | null; removable?: boolean; source?: IfConditionTemplate };

type ValueUnit = 'currency' | 'percent';
type TextPart = { text: string; highlight?: boolean };
type ValueDescriptor = { parts: TextPart[]; unit?: ValueUnit; source: 'number' | 'metric' | 'expression'; rawNumber?: number };

const positionMetricMeta: Record<string, { phrase: string; unit?: ValueUnit }> = {
  spot: { phrase: 'perp price (ETHUSDT)', unit: 'currency' },
  netEntry: { phrase: 'net entry price', unit: 'currency' },
  netMid: { phrase: 'net mid price', unit: 'currency' },
  kmid: { phrase: 'Kmid ratio' },
  pnl: { phrase: 'PnL', unit: 'currency' },
  pnlPctMax: { phrase: 'PnL as % of max profit', unit: 'percent' },
  delta: { phrase: 'total delta' },
  vega: { phrase: 'total vega' },
  theta: { phrase: 'total theta' },
  dte: { phrase: 'days to expiry' },
};

const legMetricMeta: Record<string, { phrase: string; unit?: ValueUnit }> = {
  spot: { phrase: 'underlying perp price', unit: 'currency' },
  bid: { phrase: 'bid price', unit: 'currency' },
  ask: { phrase: 'ask price', unit: 'currency' },
  mid: { phrase: 'mid price', unit: 'currency' },
  entry: { phrase: 'entry price', unit: 'currency' },
  pnlLeg: { phrase: 'leg PnL', unit: 'currency' },
  ivPct: { phrase: 'implied volatility', unit: 'percent' },
  vega: { phrase: 'vega' },
  delta: { phrase: 'delta' },
  theta: { phrase: 'theta' },
  oi: { phrase: 'open interest' },
  dSigma: { phrase: 'volatility change (Δσ)' },
};

const comparatorText: Record<IfComparator, string> = {
  '>': 'is greater than',
  '<': 'is less than',
  '=': 'equals',
  '>=': 'is at least',
  '<=': 'is at most',
};

const operatorText: Record<IfArithOp, string> = {
  '+': 'plus',
  '-': 'minus',
  '*': 'times',
  '/': 'divided by',
};

const lowerFirst = (input: string) => input.charAt(0).toLowerCase() + input.slice(1);

const formatNumber = (value: number, unit?: ValueUnit): string => {
  const abs = Math.abs(value);
  const formatter = new Intl.NumberFormat('en-US', abs >= 100 ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 2 });
  const core = formatter.format(value);
  if (unit === 'currency') return `$${core}`;
  if (unit === 'percent') return `${core}%`;
  return core;
};

const describeNumber = (value: number, unit?: ValueUnit): ValueDescriptor => ({
  parts: [{ text: formatNumber(value, unit) }],
  unit,
  source: 'number',
  rawNumber: value,
});

const positionMetricLabel = (metric: string): string => positionMetricMeta[metric]?.phrase ?? lowerFirst(posParams.find((p) => p.value === metric)?.label ?? metric);

const legMetricLabel = (metric: string): string => legMetricMeta[metric]?.phrase ?? lowerFirst(legParams.find((p) => p.value === metric)?.label ?? metric);

const findLegLabel = (symbol: string | undefined, legOptions: Array<{ symbol: string; label: string }>): string | undefined => {
  if (!symbol) return undefined;
  return legOptions.find((opt) => opt.symbol === symbol)?.label ?? symbol;
};

const describeOperand = (operand: IfOperand, chain: IfChain, ctx: ChainCtx): ValueDescriptor => {
  if (operand.kind === 'number') {
    return describeNumber(operand.value);
  }
  if (operand.kind === 'position') {
    const meta = positionMetricMeta[operand.metric];
  const phrase = positionMetricLabel(operand.metric);
  return {
    parts: [{ text: `position ${phrase}`, highlight: true }],
    unit: meta?.unit,
    source: 'metric',
  };
  }
  const meta = legMetricMeta[operand.metric];
  const phrase = legMetricLabel(operand.metric);
  if (operand.legMode === 'current') {
    const prefix = chain.scope === 'position' ? 'selected leg' : 'current leg';
    return {
      parts: [{ text: `${prefix} ${phrase}`, highlight: true }],
      unit: meta?.unit,
      source: 'metric',
    };
  }
  const symbolLabel = findLegLabel(operand.symbol ?? ctx.chainLegSymbol, ctx.legOptions);
  const owner = symbolLabel ? `${symbolLabel} ` : '';
  const label = `${owner}leg ${phrase}`.trim();
  return {
    parts: [{ text: label, highlight: true }],
    unit: meta?.unit,
    source: 'metric',
  };
};

const mergeUnit = (primary?: ValueUnit, secondary?: ValueUnit): ValueUnit | undefined => primary ?? secondary;

const withUnitForNumber = (desc: ValueDescriptor, unit?: ValueUnit): ValueDescriptor => {
  if (desc.source === 'number' && desc.rawNumber != null && unit && desc.unit !== unit) {
    return describeNumber(desc.rawNumber, unit);
  }
  return desc;
};

const describeSideText = (side: IfSide, chain: IfChain, ctx: ChainCtx): ValueDescriptor => {
  const baseDesc = describeOperand(side.base, chain, ctx);
  if (!side.op) {
    return baseDesc;
  }
  const operandDesc = describeOperand(side.op.operand, chain, ctx);
  const unit = mergeUnit(baseDesc.unit, operandDesc.unit);
  const nextUnit = side.op.operator === '/' ? undefined : unit;
  const normalizedBase = side.op.operator === '/' && baseDesc.unit ? { ...baseDesc, unit: undefined } : baseDesc;
  return {
    parts: [...normalizedBase.parts, { text: ` ${operatorText[side.op.operator]} ` }, ...operandDesc.parts],
    unit: nextUnit,
    source: 'expression',
  };
};

const capitalizeParts = (parts: TextPart[]): TextPart[] => {
  if (!parts.length) return parts;
  const [first, ...rest] = parts;
  const updated = { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) };
  return [updated, ...rest];
};

const renderParts = (parts: TextPart[], keyPrefix: string): React.ReactNode[] => {
  return parts.map((part, idx) => (
    <span
      key={`${keyPrefix}-${idx}`}
      style={part.highlight ? { fontWeight: 600, color: '#b48b5a' } : undefined}
    >
      {part.text}
    </span>
  ));
};

const describeConditionHuman = (chain: IfChain, cond: IfCond, ctx: ChainCtx): React.ReactNode => {
  const leftDesc = describeSideText(cond.left, chain, ctx);
  const rightDesc = describeSideText(cond.right, chain, ctx);
  const left = withUnitForNumber(leftDesc, rightDesc.unit);
  const right = withUnitForNumber(rightDesc, leftDesc.unit);
  const capitalizedLeft = { ...left, parts: capitalizeParts(left.parts) };
  return (
    <>
      {renderParts(capitalizedLeft.parts, 'left')}
      <span> {comparatorText[cond.cmp]} </span>
      {renderParts(right.parts, 'right')}
    </>
  );
};

const sanitizeLegSymbol = (symbol: string | undefined, legOptions: Array<{ symbol: string; label: string }>): string | undefined => {
  if (!symbol) return undefined;
  return legOptions.some((opt) => opt.symbol === symbol) ? symbol : undefined;
};

const createOperand = (kind: 'number' | 'position' | 'leg', ctx: ChainCtx): IfOperand => {
  if (kind === 'number') return { kind: 'number', value: 0 };
  if (kind === 'position') return { kind: 'position', metric: defaultPositionMetric };
  const legMode: 'current' | 'symbol' = ctx.scope === 'leg' ? 'current' : 'symbol';
  const symbol = ctx.scope === 'leg' ? ctx.chainLegSymbol : ctx.legOptions[0]?.symbol;
  return { kind: 'leg', metric: defaultLegMetric, legMode, symbol: legMode === 'symbol' ? sanitizeLegSymbol(symbol, ctx.legOptions) : undefined };
};

const sanitizeOperand = (input: any, ctx: ChainCtx): IfOperand => {
  if (input?.kind === 'number') {
    const value = Number(input.value);
    return { kind: 'number', value: Number.isFinite(value) ? value : 0 };
  }
  if (input?.kind === 'position') {
    const metric = typeof input.metric === 'string' ? input.metric : defaultPositionMetric;
    return { kind: 'position', metric };
  }
  if (input?.kind === 'leg') {
    const metric = typeof input.metric === 'string' ? input.metric : defaultLegMetric;
    let legMode: 'current' | 'symbol' = input.legMode === 'symbol' ? 'symbol' : 'current';
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

const sanitizeSide = (input: any, ctx: ChainCtx): IfSide => {
  const base = sanitizeOperand(input?.base, ctx);
  if (input?.op && input.op.operator && input.op.operand) {
    const operator = ['+','-','*','/'].includes(input.op.operator) ? input.op.operator as IfArithOp : '+';
    const operand = sanitizeOperand(input.op.operand, ctx);
    return { base, op: { operator, operand } };
  }
  return { base };
};

const legSymbolFromOperand = (operand: IfOperand): string | undefined => {
  if (operand.kind === 'leg' && operand.legMode === 'symbol' && operand.symbol) {
    return operand.symbol;
  }
  return undefined;
};

const legSymbolFromSide = (side: IfSide): string | undefined => {
  return legSymbolFromOperand(side.base) || (side.op ? legSymbolFromOperand(side.op.operand) : undefined);
};

const inferLegSymbolFromCond = (cond: IfCond): string | undefined => {
  return legSymbolFromSide(cond.left) || legSymbolFromSide(cond.right);
};

const comparatorOrDefault = (cmp: any): IfComparator => ((['>','<','=','>=','<='] as const).includes(cmp) ? cmp : '>');

const defaultCond = (ctx: ChainCtx): IfCond => {
  const leftBase = ctx.scope === 'leg'
    ? sanitizeOperand({ kind: 'leg', metric: defaultLegMetric, legMode: 'current' }, ctx)
    : sanitizeOperand({ kind: 'position', metric: defaultPositionMetric }, ctx);
  return {
    left: { base: leftBase },
    cmp: '>',
    right: { base: { kind: 'number', value: ctx.scope === 'leg' ? 0 : 0 } },
  };
};

const migrateCond = (scope: 'position' | 'leg', raw: any, ctx: ChainCtx): IfCond => {
  const legacyToOperand = (value: any): IfOperand => {
    if (!value || typeof value !== 'object') return createOperand(scope === 'leg' ? 'leg' : 'position', ctx);
    if (value.kind === 'number') return sanitizeOperand(value, ctx);
    if (value.kind === 'metric') {
      if (value.scope === 'position') return sanitizeOperand({ kind: 'position', metric: value.param }, ctx);
      return sanitizeOperand({ kind: 'leg', metric: value.param, legMode: scope === 'leg' ? 'current' : 'symbol' }, ctx);
    }
    return createOperand(scope === 'leg' ? 'leg' : 'position', ctx);
  };
  if (raw && raw.left && raw.right) {
    return {
      left: sanitizeSide(raw.left, ctx),
      cmp: comparatorOrDefault(raw.cmp),
      right: sanitizeSide(raw.right, ctx),
    };
  }
  const expressionToSide = (expr: any): IfSide => {
    if (expr && expr.base) {
      const base = legacyToOperand(expr.base);
      if (expr.op && expr.op.operator && expr.op.value) {
        const operator = ['+','-','*','/'].includes(expr.op.operator) ? expr.op.operator as IfArithOp : '+';
        const operand = legacyToOperand(expr.op.value);
        return { base, op: { operator, operand } };
      }
      return { base };
    }
    return { base: legacyToOperand(undefined) };
  };
  if (raw && raw.lhs && raw.rhs) {
    return {
      left: expressionToSide(raw.lhs),
      cmp: comparatorOrDefault(raw.cmp),
      right: expressionToSide(raw.rhs),
    };
  }
  if (raw && raw.param) {
    const left = scope === 'position'
      ? { base: sanitizeOperand({ kind: 'position', metric: raw.param }, ctx) }
      : { base: sanitizeOperand({ kind: 'leg', metric: raw.param, legMode: 'current' }, ctx) };
    return {
      left,
      cmp: comparatorOrDefault(raw.cmp),
      right: { base: sanitizeOperand({ kind: 'number', value: raw.value }, ctx) },
    };
  }
  return defaultCond(ctx);
};

const migrateChain = (raw: any, ctx: ChainCtx): IfChain => {
  const scope: 'position' | 'leg' = raw?.scope === 'position' ? 'position' : 'leg';
  const scopedCtx: ChainCtx = { ...ctx, scope, chainLegSymbol: sanitizeLegSymbol(raw?.legSymbol, ctx.legOptions) };
  const conds = Array.isArray(raw?.conds) ? raw.conds : [];
  const list = conds.length ? conds : [undefined];
  return {
    scope,
    legSymbol: scopedCtx.chainLegSymbol,
    conds: list.map((item: any, idx: number) => ({
      conj: idx === 0 ? undefined : (item?.conj === 'OR' ? 'OR' : 'AND'),
      cond: migrateCond(scope, item?.cond ?? item, scopedCtx),
    })),
  };
};

export const migrateRule = (initial: any, legOptions: Array<{ symbol: string; label: string }> = []): IfRule => {
  const ctx: ChainCtx = { scope: 'leg', chainLegSymbol: undefined, legOptions };
  if (!initial) {
    return { chains: [] };
  }
  if (Array.isArray((initial as any).chains)) {
    return {
      chains: (initial as any).chains.map((item: any, idx: number) => ({
        conj: idx === 0 ? undefined : (item?.conj === 'OR' ? 'OR' : 'AND'),
        chain: migrateChain(item?.chain ?? item, ctx),
      })),
    };
  }
  return { chains: [ { chain: migrateChain(initial, ctx) } ] };
};

const sanitizeCond = (cond: any, ctx: ChainCtx): IfCond => ({
  left: sanitizeSide(cond?.left, ctx),
  cmp: comparatorOrDefault(cond?.cmp),
  right: sanitizeSide(cond?.right, ctx),
});

const sanitizeChain = (chain: any, ctx: ChainCtx): IfChain => {
  const scope: 'position' | 'leg' = chain?.scope === 'position' ? 'position' : 'leg';
  const scopedCtx: ChainCtx = { ...ctx, scope, chainLegSymbol: sanitizeLegSymbol(chain?.legSymbol, ctx.legOptions) };
  const rawConds = Array.isArray(chain?.conds) ? chain.conds as any[] : undefined;
  const conds = rawConds !== undefined ? rawConds : [ { cond: defaultCond(scopedCtx) } ];
  return {
    scope,
    legSymbol: scopedCtx.chainLegSymbol,
    conds: conds.map((item: any, idx: number) => ({
      conj: idx === 0 ? undefined : (item?.conj === 'OR' ? 'OR' : 'AND'),
      cond: sanitizeCond(item?.cond ?? item, scopedCtx),
    })),
  };
};

export function IfModal({ title, legOptions, initial, ruleKey, onSave, onClose, evalCondLive, evalCondDetails, templates = [], onSaveTemplate, onDeleteTemplate, onDeleteTemplates }: Props) {
  const [rule, setRule] = React.useState<IfRule>(() => migrateRule(initial, legOptions));
  const legOptionsKey = React.useMemo(() => legOptions.map((opt) => opt.symbol).join('|'), [legOptions]);
  const [manageTemplates, setManageTemplates] = React.useState(false);
  const [selectedTemplates, setSelectedTemplates] = React.useState<Set<string>>(() => new Set<string>());

  React.useEffect(() => {
    setRule(migrateRule(initial, legOptions));
  }, [initial, legOptionsKey, ruleKey]);

  React.useEffect(() => {
    setSelectedTemplates((prev) => {
      const next = new Set<string>();
      templates.forEach((tpl) => {
        const key = `${tpl.scope}:${tpl.name}`;
        if (prev.has(key)) next.add(key);
      });
      return next;
    });
  }, [templates]);

  const chainCtx = (chain: IfChain): ChainCtx => ({ scope: chain.scope, chainLegSymbol: chain.legSymbol, legOptions });

  const applyChainUpdate = (idx: number, next: IfChain) => {
    const ctx = chainCtx(next);
    const clean = sanitizeChain(next, ctx);
    setRule((r) => ({ chains: r.chains.map((c, i) => i === idx ? { ...c, chain: clean } : c) }));
  };

  const makeDefaultChain = (scope: 'position' | 'leg', legSymbol?: string): IfChain => {
    const ctx = { scope, chainLegSymbol: legSymbol, legOptions } as ChainCtx;
    const raw = { scope, legSymbol, conds: [ { cond: defaultCond(ctx) } ] };
    return sanitizeChain(raw, ctx);
  };

  const updateChainConj = (idx: number, conj?: 'AND'|'OR') => {
    setRule((r) => ({ chains: r.chains.map((c, i) => i === idx ? { ...c, conj } : c) }));
  };
  const addChain = (scope: 'position' | 'leg' = 'leg') => {
    setRule((r) => {
      const chain = makeDefaultChain(scope, undefined);
      return { chains: [...r.chains, { conj: r.chains.length ? 'AND' : undefined, chain }] };
    });
  };
  const removeChain = (idx: number) => setRule((r) => ({ chains: r.chains.filter((_, i) => i !== idx) }));

  const handleSave = () => {
    const prepared: IfRule = {
      chains: rule.chains.map((item, idx) => {
        const ctx = chainCtx(item.chain);
        return {
          conj: idx === 0 ? undefined : (item.conj === 'OR' ? 'OR' : 'AND'),
          chain: sanitizeChain(item.chain, ctx),
        };
      }),
    };
    onSave(prepared);
  };

  const updateCondition = (chainIdx: number, condIdx: number, next: IfCond) => {
    const chain = rule.chains[chainIdx].chain;
    const ctx = chainCtx(chain);
    const sanitized = sanitizeCond(next, ctx);
    const nextConds = chain.conds.map((c, i) => i === condIdx ? { ...c, cond: sanitized } : c) as IfChain['conds'];
    applyChainUpdate(chainIdx, { ...chain, conds: nextConds });
  };

  const updateConditionConj = (chainIdx: number, condIdx: number, conj: 'AND' | 'OR') => {
    const chain = rule.chains[chainIdx].chain;
    const nextConds = chain.conds.map((c, i) => i === condIdx ? { ...c, conj } : c) as IfChain['conds'];
    applyChainUpdate(chainIdx, { ...chain, conds: nextConds });
  };

  const addCondition = (chainIdx: number) => {
    const chain = rule.chains[chainIdx].chain;
    const ctx = chainCtx(chain);
    const nextConds = [...chain.conds, { conj: 'AND', cond: defaultCond(ctx) }] as IfChain['conds'];
    applyChainUpdate(chainIdx, { ...chain, conds: nextConds });
  };

  const removeCondition = (chainIdx: number, condIdx: number) => {
    const chain = rule.chains[chainIdx].chain;
    const nextConds = chain.conds.filter((_, i) => i !== condIdx) as IfChain['conds'];
    if (!nextConds.length) {
      removeChain(chainIdx);
      return;
    }
    applyChainUpdate(chainIdx, { ...chain, conds: nextConds });
  };

  const quickTemplates = React.useMemo<QuickTemplate[]>(() => {
    return templates.map((tpl) => {
      const storedLegSymbol = tpl.legSymbol === undefined ? undefined : (tpl.legSymbol ?? null);
      return {
        scope: tpl.scope,
        label: `⭐ ${tpl.name}`,
        build: (ctx: ChainCtx) => sanitizeCond(tpl.cond, ctx),
        legSymbol: storedLegSymbol,
        removable: true,
        source: tpl,
      };
    });
  }, [templates]);

  type SummaryItem = {
    key: string;
    conj?: 'AND' | 'OR';
    chainIdx: number;
    condIdx: number;
    chainLabel: string;
    description: React.ReactNode;
    valueText: string;
    satisfied?: boolean;
  };

  const conditionSummaries = React.useMemo<SummaryItem[]>(() => {
    const lines: SummaryItem[] = [];
    rule.chains.forEach((block, idx) => {
      const chain = block.chain;
      const ctx = chainCtx(chain);
      const chainLabel = chain.scope === 'position'
        ? 'Position block'
        : (() => {
          if (chain.legSymbol) {
            const label = findLegLabel(chain.legSymbol, legOptions) ?? chain.legSymbol;
            return `Leg block (${label})`;
          }
          return 'Leg block (any leg)';
        })();
      chain.conds.forEach((item, jdx) => {
        const cond = sanitizeCond(item.cond, ctx);
        const description = describeConditionHuman(chain, cond, ctx);
        let conj: 'AND' | 'OR' | undefined;
        if (jdx > 0) {
          conj = item.conj === 'OR' ? 'OR' : 'AND';
        } else if (idx > 0) {
          conj = block.conj === 'OR' ? 'OR' : 'AND';
        }
        const detail = evalCondDetails?.({ scope: chain.scope, legSymbol: chain.legSymbol, cond });
        const fallbackSatisfied = detail?.satisfied ?? (evalCondLive ? evalCondLive({ scope: chain.scope, legSymbol: chain.legSymbol, cond }) : undefined);
        const valueUnit = (() => {
          const leftDesc = describeSideText(cond.left, chain, ctx);
          const rightDesc = describeSideText(cond.right, chain, ctx);
          const merged = withUnitForNumber(leftDesc, rightDesc.unit);
          return merged.unit;
        })();
        const valueText = (() => {
          const value = detail?.lhs;
          if (value != null && Number.isFinite(value)) return formatNumber(value, valueUnit);
          return '—';
        })();
        lines.push({
          key: `${idx}-${jdx}`,
          conj,
          chainIdx: idx,
          condIdx: jdx,
          chainLabel,
          description,
          valueText,
          satisfied: fallbackSatisfied,
        });
      });
    });
    return lines;
  }, [rule, legOptions, evalCondDetails, evalCondLive]);

  const applyTemplate = (tpl: QuickTemplate) => {
    setRule((prev) => {
      let idx = prev.chains.findIndex((item) => item.chain.scope === tpl.scope);
      let chains = [...prev.chains];
      let injected = false;
      if (idx === -1) {
        const chain = makeDefaultChain(tpl.scope, undefined);
        chains = [...chains, { conj: chains.length ? 'AND' : undefined, chain }];
        idx = chains.length - 1;
        injected = true;
      }
      const chainSource = chains[idx].chain;
      const baseChain = injected ? { ...chainSource, conds: [] } : chainSource;
      const ctx = chainCtx(baseChain);
      const cond = tpl.build(ctx);
      let legSymbol = baseChain.legSymbol;
      if (tpl.scope === 'leg') {
        if (tpl.legSymbol !== undefined) {
          legSymbol = tpl.legSymbol ?? undefined;
        } else if (!legSymbol) {
          legSymbol = inferLegSymbolFromCond(cond) ?? legSymbol;
        }
      } else if (baseChain.scope === 'leg' && !legSymbol) {
        legSymbol = inferLegSymbolFromCond(cond) ?? legSymbol;
      }
      const chainForCtx: IfChain = { ...baseChain, legSymbol };
      const conds = [...chainForCtx.conds, { conj: chainForCtx.conds.length ? 'AND' : undefined, cond }];
      const scopedCtx: ChainCtx = { scope: chainForCtx.scope, chainLegSymbol: chainForCtx.legSymbol, legOptions };
      chains[idx] = { ...chains[idx], chain: sanitizeChain({ ...chainForCtx, conds }, scopedCtx) };
      return { chains };
    });
  };

  const handleDeleteTemplate = (tpl: QuickTemplate) => {
    if (!tpl.removable || !tpl.source) return;
    if (!onDeleteTemplate && !onDeleteTemplates) return;
    const ok = window.confirm(`Delete template "${tpl.source.name}"?`);
    if (!ok) return;
    if (onDeleteTemplate) onDeleteTemplate(tpl.source);
    else onDeleteTemplates?.([tpl.source]);
  };

  const toggleManageTemplates = () => {
    setManageTemplates((prev) => {
      if (prev) setSelectedTemplates(new Set<string>());
      return !prev;
    });
  };

  const toggleTemplateSelected = (tpl: QuickTemplate) => {
    if (!tpl.source) return;
    const key = `${tpl.source.scope}:${tpl.source.name}`;
    setSelectedTemplates((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const deleteSelectedTemplates = () => {
    if (!onDeleteTemplate && !onDeleteTemplates) return;
    const targets = templates.filter((tpl) => selectedTemplates.has(`${tpl.scope}:${tpl.name}`));
    if (!targets.length) return;
    const ok = window.confirm(`Delete selected templates (${targets.length})?`);
    if (!ok) return;
    if (onDeleteTemplates) onDeleteTemplates(targets);
    else targets.forEach((tpl) => onDeleteTemplate?.(tpl));
    setSelectedTemplates(new Set<string>());
    setManageTemplates(false);
  };

  const deleteAllTemplates = () => {
    if (!onDeleteTemplate && !onDeleteTemplates) return;
    const targets = [...templates];
    if (!targets.length) return;
    const ok = window.confirm('Delete all saved templates?');
    if (!ok) return;
    if (onDeleteTemplates) onDeleteTemplates(targets);
    else targets.forEach((tpl) => onDeleteTemplate?.(tpl));
    setSelectedTemplates(new Set<string>());
    setManageTemplates(false);
  };

  const isSelected = (tpl: QuickTemplate) => tpl.source ? selectedTemplates.has(`${tpl.source.scope}:${tpl.source.name}`) : false;

  const renderOperandEditor = (operand: IfOperand, ctx: ChainCtx, onChange: (next: IfOperand) => void) => {
    const source = operand.kind;
    const allowLeg = legOptions.length > 0;
    const onSourceChange = (nextSource: string) => {
      if (nextSource === 'number') onChange(sanitizeOperand({ kind: 'number', value: 0 }, ctx));
      else if (nextSource === 'position') onChange(sanitizeOperand({ kind: 'position', metric: defaultPositionMetric }, ctx));
      else if (nextSource === 'leg' && allowLeg) onChange(sanitizeOperand(createOperand('leg', ctx), ctx));
    };
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={source} onChange={(e) => onSourceChange(e.target.value)}>
          <option value="position">Position</option>
          {allowLeg && <option value="leg">Leg</option>}
          <option value="number">Number</option>
        </select>
        {operand.kind === 'number' ? (
          <input type="number" step="any" value={operand.value} onChange={(e) => onChange({ kind: 'number', value: Number(e.target.value) })} style={{ width: 110 }} />
        ) : operand.kind === 'position' ? (
          <select value={operand.metric} onChange={(e) => onChange({ kind: 'position', metric: e.target.value })}>
            {posParams.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        ) : allowLeg ? (
          <>
            {ctx.scope === 'leg' && (
              <select value={operand.legMode === 'current' ? 'current' : (operand.symbol || '')} onChange={(e) => {
                const val = e.target.value;
                if (val === 'current') onChange({ kind: 'leg', metric: operand.metric, legMode: 'current' });
                else onChange({ kind: 'leg', metric: operand.metric, legMode: 'symbol', symbol: val });
              }}>
                <option value="current">This leg</option>
                {legOptions.map((opt) => (
                  <option key={opt.symbol} value={opt.symbol}>{opt.label}</option>
                ))}
              </select>
            )}
            {ctx.scope !== 'leg' && allowLeg && (
              <select value={operand.symbol || legOptions[0]?.symbol || ''} onChange={(e) => onChange({ kind: 'leg', metric: operand.metric, legMode: 'symbol', symbol: e.target.value })}>
                {legOptions.map((opt) => (
                  <option key={opt.symbol} value={opt.symbol}>{opt.label}</option>
                ))}
              </select>
            )}
            <select value={operand.metric} onChange={(e) => onChange({ ...operand, metric: e.target.value })}>
              {legParams.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </>
        ) : (
          <span className="muted">Leg metrics unavailable</span>
        )}
      </div>
    );
  };

  const renderSideEditor = (side: IfSide, ctx: ChainCtx, onChange: (next: IfSide) => void) => {
    const update = (next: IfSide) => onChange(sanitizeSide(next, ctx));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {renderOperandEditor(side.base, ctx, (nextOperand) => update({ ...side, base: nextOperand }))}
        {side.op ? (
          (() => {
            const opState = side.op!;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <select value={opState.operator} onChange={(e) => update({ ...side, op: { operator: (['+','-','*','/'].includes(e.target.value) ? e.target.value as IfArithOp : '+'), operand: opState.operand } })}>
                  <option value="+">+</option>
                  <option value="-">-</option>
                  <option value="*">×</option>
                  <option value="/">÷</option>
                </select>
                {renderOperandEditor(opState.operand, ctx, (nextOperand) => update({ ...side, op: { operator: opState.operator, operand: nextOperand } }))}
                <button className="ghost" onClick={() => update({ base: side.base })}>Remove operand</button>
              </div>
            );
          })()
        ) : (
          <button className="ghost" onClick={() => update({ ...side, op: { operator: '+', operand: createOperand('number', ctx) } })}>+ Operand</button>
        )}
      </div>
    );
  };

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
          <div className="muted" style={{marginBottom:8}}>Build conditions using position or leg blocks. Each condition holds one arithmetic expression.</div>
          {quickTemplates.length > 0 && (
            <div style={{display:'flex', gap:6, alignItems:'center', marginBottom:10, flexWrap:'wrap'}}>
              <span className="muted">Templates:</span>
              {templates.length > 0 && (onDeleteTemplate || onDeleteTemplates) && (
                <button className="ghost" onClick={toggleManageTemplates}>{manageTemplates ? 'Done' : 'Manage'}</button>
              )}
              {quickTemplates.map((tpl, idx) => (
                <div key={`${tpl.label}-${idx}`} style={{display:'flex', alignItems:'center', gap:4}}>
                  {manageTemplates && tpl.removable && tpl.source && (
                    <input
                      type="checkbox"
                      checked={isSelected(tpl)}
                      onChange={() => toggleTemplateSelected(tpl)}
                    />
                  )}
                  <button className="ghost" onClick={() => applyTemplate(tpl)}>{tpl.label}</button>
                  {!manageTemplates && tpl.removable && (onDeleteTemplate || onDeleteTemplates) && tpl.source && (
                    <button className="ghost" title="Delete template" onClick={() => handleDeleteTemplate(tpl)}>×</button>
                  )}
                </div>
              ))}
              {manageTemplates && templates.length > 0 && (
                <>
                  <button className="ghost" disabled={!templates.length || selectedTemplates.size === 0} onClick={deleteSelectedTemplates}>Delete selected</button>
                  <button className="ghost" disabled={!templates.length} onClick={deleteAllTemplates}>Delete all</button>
                </>
              )}
            </div>
          )}
          {conditionSummaries.length > 0 && (
            <div style={{display:'flex', flexDirection:'column', gap:4, marginBottom:14}}>
              <span className="muted">Condition overview:</span>
              {conditionSummaries.map((item) => (
                <React.Fragment key={item.key}>
                  {item.conj && (
                    <div style={{fontSize:'0.75em', fontWeight:600, letterSpacing:0.5, color:'var(--fg-muted, #666)'}}>{item.conj}</div>
                  )}
                  <div style={{display:'flex', alignItems:'center', gap:6, fontSize:'0.92em'}}>
                    <button
                      className="ghost"
                      title="Remove condition"
                      onClick={() => removeCondition(item.chainIdx, item.condIdx)}
                      style={{padding: '0 6px'}}
                    >
                      ×
                    </button>
                    <div style={{display:'flex', flexWrap:'wrap', gap:4, alignItems:'baseline'}}>
                      <span style={{fontWeight:600}}>{item.chainLabel}:</span> {item.description}
                      <span style={{marginLeft:6, fontWeight:600, color: item.satisfied ? '#2ecc71' : '#777'}}>
                        → {item.valueText}
                      </span>
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            {rule.chains.map((block, idx) => {
              const chain = block.chain;
              const ctx = chainCtx(chain);
              return (
                <div key={idx} style={{border:'1px solid var(--border)', borderRadius:8, padding:10}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:8}}>
                    {idx > 0 && (
                      <select value={block.conj || 'AND'} onChange={(e)=>{
                        const value = e.target.value === 'OR' ? 'OR' : 'AND';
                        updateChainConj(idx, value);
                      }}>
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                    )}
                    <span className="muted">Block</span>
                    <select value={chain.scope} onChange={(e)=>{
                      const value = e.target.value === 'position' ? 'position' : 'leg';
                      applyChainUpdate(idx, { ...chain, scope: value });
                    }}>
                      <option value="position">Position</option>
                      <option value="leg">Legs</option>
                    </select>
                    {chain.scope === 'leg' && legOptions.length > 0 && (
                      <select value={chain.legSymbol || ''} onChange={(e)=>{
                        const value = e.target.value || undefined;
                        applyChainUpdate(idx, { ...chain, legSymbol: value });
                      }}>
                        <option value="">Any leg</option>
                        {legOptions.map((opt) => (
                          <option key={opt.symbol} value={opt.symbol}>{opt.label}</option>
                        ))}
                      </select>
                    )}
                    <span className="muted">conditions: {chain.conds.length}</span>
                    <div style={{marginLeft:'auto'}}>
                      <button className="ghost" onClick={()=>removeChain(idx)}>Remove block</button>
                    </div>
                  </div>
                  <div style={{display:'flex', flexDirection:'column', gap:10}}>
                    {chain.conds.map((item, jdx) => {
                      const cond = sanitizeCond(item.cond, ctx);
                      const done = evalCondLive ? evalCondLive({ scope: chain.scope, legSymbol: chain.legSymbol, cond }) : false;
                      const handleSaveTemplate = () => {
                        if (!onSaveTemplate) return;
                        const name = window.prompt('Template name for this condition:');
                        if (!name) return;
                        const clone = JSON.parse(JSON.stringify(cond)) as IfCond;
                        const payload: IfConditionTemplate = { name, scope: chain.scope, cond: clone };
                        if (chain.scope === 'leg') {
                          payload.legSymbol = chain.legSymbol ?? null;
                        }
                        onSaveTemplate(payload);
                      };
                      return (
                        <div key={jdx} style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-start', border:'1px dashed var(--border)', borderRadius:6, padding:8}}>
                          {jdx > 0 && (
                            <select value={item.conj || 'AND'} onChange={(e)=>{
                              const conj = e.target.value === 'OR' ? 'OR' : 'AND';
                              updateConditionConj(idx, jdx, conj);
                            }}>
                              <option value="AND">AND</option>
                              <option value="OR">OR</option>
                            </select>
                          )}
                          <div style={{display:'flex', flexDirection:'column', gap:4}}>
                            <span className="muted">Left side</span>
                            {renderSideEditor(cond.left, ctx, (nextSide) => updateCondition(idx, jdx, { ...cond, left: nextSide }))}
                          </div>
                          <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
                            <span className="muted">Comparator</span>
                            <select value={cond.cmp} onChange={(e)=>updateCondition(idx, jdx, { ...cond, cmp: comparatorOrDefault(e.target.value) })}>
                              <option value=">">&gt;</option>
                              <option value="<">&lt;</option>
                              <option value="=">=</option>
                              <option value=">=">≥</option>
                              <option value="<=">≤</option>
                            </select>
                          </div>
                          <div style={{display:'flex', flexDirection:'column', gap:4}}>
                            <span className="muted">Right side</span>
                            {renderSideEditor(cond.right, ctx, (nextSide) => updateCondition(idx, jdx, { ...cond, right: nextSide }))}
                          </div>
                          <div style={{alignSelf:'center', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                            <span title={done ? 'Condition currently true' : 'Condition not met'} style={{color: done ? '#2ecc71' : '#777', fontSize:'1.1em'}}>●</span>
                            {onSaveTemplate && (
                              <button className="ghost" onClick={handleSaveTemplate}>Save template</button>
                            )}
                            <button className="ghost" onClick={()=>removeCondition(idx, jdx)}>Remove</button>
                          </div>
                        </div>
                      );
                    })}
                    <div>
                      <button className="ghost" onClick={()=>addCondition(idx)}>+ Add condition</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{display:'flex', alignItems:'center', gap:8, marginTop:12}}>
            <button className="ghost" onClick={()=>addChain('leg')}>+ Leg block</button>
            <button className="ghost" onClick={()=>addChain('position')}>+ Position block</button>
            <div style={{marginLeft:'auto', display:'flex', gap:8}}>
              <button className="ghost" onClick={onClose}>Cancel</button>
              <button className="primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
