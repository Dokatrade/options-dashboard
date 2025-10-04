import React from 'react';
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, type CandlestickData, type SeriesMarker, type UTCTimestamp } from 'lightweight-charts';
import { fetchSpotKlines } from '../services/bybit';
import type { SpotKline } from '../utils/types';

const INTERVALS = {
  '60': { label: '1H', minutes: 60, api: '60' },
  '240': { label: '4H', minutes: 240, api: '240' },
  '1440': { label: '1D', minutes: 1440, api: 'D' },
} as const;

type IntervalKey = keyof typeof INTERVALS;

type SpotPriceChartProps = {
  active: boolean;
  symbol?: string;
  interval?: IntervalKey;
  entryTimestamp?: number;
  exitTimestamp?: number;
  exitPrice?: number;
};

const HEIGHT = 360;
const POLL_MS = 180_000; // refresh every 3 minutes
const MAX_LIMIT = 1000;

function mapToCandles(data: SpotKline[]): CandlestickData<UTCTimestamp>[] {
  return data.map((item) => ({
    time: Math.floor(item.openTime / 1000) as UTCTimestamp,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
  }));
}

function findMarkerCandle(
  data: SpotKline[],
  timestamp?: number,
  interval?: IntervalKey,
  explicitPrice?: number,
): { candle: SpotKline; price: number } | undefined {
  if (!timestamp || !data.length) return undefined;
  const cfg = INTERVALS[interval ?? '60'] ?? INTERVALS['60'];
  const intervalMinutes = cfg.minutes;
  const intervalMs = intervalMinutes * 60_000;
  const sorted = [...data].sort((a, b) => a.openTime - b.openTime);
  let match: SpotKline | undefined;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const item = sorted[i];
    if (timestamp >= item.openTime) {
      match = item;
      break;
    }
  }
  if (!match) {
    match = sorted[0];
  }
  const limit = match.openTime + intervalMs;
  if (timestamp > limit && sorted.length > 1) {
    const next = sorted.find((c) => c.openTime >= limit);
    if (next) match = next;
  }
  const price = typeof explicitPrice === 'number' && Number.isFinite(explicitPrice)
    ? explicitPrice
    : (Number.isFinite(match.close) ? match.close : match.open);
  return { candle: match, price };
}

export function SpotPriceChart({ active, symbol = 'ETHUSDT', interval = '60', entryTimestamp, exitTimestamp, exitPrice }: SpotPriceChartProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<'Candlestick'> | null>(null);
  const entryLineRef = React.useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);
  const exitLineRef = React.useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);
  const [series, setSeries] = React.useState<SpotKline[]>([]);
  const seriesDataRef = React.useRef<SpotKline[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [updatedAt, setUpdatedAt] = React.useState<number | undefined>();
  const loadingOlderRef = React.useRef(false);
  const allLoadedRef = React.useRef(false);
  const oldestRequestedRef = React.useRef<number | undefined>(undefined);
  const hasFitRef = React.useRef(false);
  const intervalValue: IntervalKey = interval ?? '60';
  const intervalCfg = INTERVALS[intervalValue] ?? INTERVALS['60'];
  const intervalLabel = intervalCfg.label;

  // Initialize chart when active
  React.useEffect(() => {
    if (!active) return () => {};
    const container = containerRef.current;
    if (!container) return () => {};

    const resolveColor = (variable: string, fallback: string) => {
      if (typeof window === 'undefined') return fallback;
      const value = getComputedStyle(document.documentElement).getPropertyValue(variable);
      return value && value.trim() ? value.trim() : fallback;
    };

    const fgColor = resolveColor('--fg', '#e5e7eb');
    const borderColor = resolveColor('--border', 'rgba(255,255,255,0.12)');
    const bgAlt = resolveColor('--bg-alt', 'rgba(17,24,39,0.4)');
    const gridColor = 'rgba(255,255,255,0.08)';

    const chart = createChart(container, {
      width: container.clientWidth,
      height: HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: bgAlt },
        textColor: fgColor,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: {
        rightOffset: 6,
        rightBarStaysOnScroll: true,
        secondsVisible: false,
        timeVisible: true,
        borderColor,
      },
      rightPriceScale: {
        borderColor,
      },
    });

    const seriesApi = chart.addCandlestickSeries({
      upColor: '#43a047',
      downColor: '#e53935',
      wickUpColor: '#43a047',
      wickDownColor: '#e53935',
      borderVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = seriesApi;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
    });
    ro.observe(container);

    const handleRange = () => {
      if (loadingOlderRef.current || allLoadedRef.current) return;
      const seriesApiCurrent = seriesRef.current;
      if (!seriesApiCurrent) return;
      const logicalRange = chart.timeScale().getVisibleLogicalRange();
      if (!logicalRange) return;
      const barsInfo = seriesApiCurrent.barsInLogicalRange(logicalRange as any);
      if (!barsInfo || barsInfo.barsBefore == null || barsInfo.barsBefore > 10) return;
      const currentSeries = seriesDataRef.current;
      if (!currentSeries.length) return;
      const earliest = currentSeries[0];
      if (!earliest) return;
      if (oldestRequestedRef.current === earliest.openTime) return;

      loadingOlderRef.current = true;
      oldestRequestedRef.current = earliest.openTime;

      const intervalMinutes = intervalCfg.minutes;
      const intervalMs = Math.max(intervalMinutes * 60_000, 60_000);
      const prevRange = {
        from: Number((logicalRange as any).from ?? 0),
        to: Number((logicalRange as any).to ?? 0),
      };
      const end = earliest.openTime - 1;
      const start = Math.max(0, end - intervalMs * MAX_LIMIT);

      fetchSpotKlines({ symbol, interval: intervalCfg.api, limit: MAX_LIMIT, start, end }).then((older) => {
        if (!older.length) {
          allLoadedRef.current = true;
          return;
        }
        if (older.length < MAX_LIMIT) allLoadedRef.current = true;
        setSeries((prev) => {
          const map = new Map<number, SpotKline>();
          [...older, ...prev].forEach((item) => {
            map.set(item.openTime, item);
          });
          const merged = Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);
          seriesDataRef.current = merged;
          oldestRequestedRef.current = undefined;
          const inserted = merged.length - prev.length;
          if (inserted > 0 && chartRef.current && Number.isFinite(prevRange.from) && Number.isFinite(prevRange.to)) {
            const nextRange = {
              from: prevRange.from + inserted,
              to: prevRange.to + inserted,
            };
            const raf = typeof requestAnimationFrame === 'function'
              ? requestAnimationFrame
              : ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16));
            raf(() => {
              const chartInst = chartRef.current;
              if (!chartInst) return;
              chartInst.timeScale().setVisibleLogicalRange(nextRange as any);
            });
          }
          return merged;
        });
      }).catch((err) => {
        console.warn('[spot-chart] older fetch failed', err);
      }).finally(() => {
        loadingOlderRef.current = false;
      });
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRange);

    return () => {
      if (entryLineRef.current && seriesApi) {
        seriesApi.removePriceLine(entryLineRef.current);
        entryLineRef.current = null;
      }
      if (exitLineRef.current && seriesApi) {
        seriesApi.removePriceLine(exitLineRef.current);
        exitLineRef.current = null;
      }
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRange);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      loadingOlderRef.current = false;
      allLoadedRef.current = false;
      oldestRequestedRef.current = undefined;
      hasFitRef.current = false;
    };
  }, [active, symbol, intervalValue]);

  // Fetch data polling when active
  React.useEffect(() => {
    if (!active) return () => {};
    let cancelled = false;

    const load = async (background = false) => {
      if (!active || cancelled) return;
      if (!background) setLoading(true);
      try {
        const data = await fetchSpotKlines({ symbol, interval: intervalCfg.api, limit: MAX_LIMIT });
        if (cancelled) return;
        const sorted = [...data].sort((a, b) => a.openTime - b.openTime);
        seriesDataRef.current = sorted;
        setSeries(sorted);
        setError(undefined);
        setUpdatedAt(Date.now());
        allLoadedRef.current = data.length < MAX_LIMIT;
        oldestRequestedRef.current = undefined;
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error && err.message ? err.message : 'Failed to load spot data';
        setError(message);
      } finally {
        if (!background && !cancelled) setLoading(false);
      }
    };

    loadingOlderRef.current = false;
    allLoadedRef.current = false;
    oldestRequestedRef.current = undefined;
    hasFitRef.current = false;
    seriesDataRef.current = [];
    setSeries([]);
    load();
    const id = window.setInterval(() => load(true), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, symbol, intervalValue]);

  // Push data to chart
  React.useEffect(() => {
    if (!active) return;
    const chart = chartRef.current;
    const seriesApi = seriesRef.current;
    if (!chart || !seriesApi) return;
    const candles = mapToCandles(series);
    seriesApi.setData(candles);
    if (!candles.length) return;
    if (!hasFitRef.current) {
      chart.timeScale().fitContent();
      hasFitRef.current = true;
    }
  }, [series, active]);

  React.useEffect(() => {
    seriesDataRef.current = series;
  }, [series]);

  // Update entry marker/line
  React.useEffect(() => {
    if (!active) return;
    const seriesApi = seriesRef.current;
    if (!seriesApi) return;

    if (entryLineRef.current) {
      seriesApi.removePriceLine(entryLineRef.current);
      entryLineRef.current = null;
    }
    if (exitLineRef.current) {
      seriesApi.removePriceLine(exitLineRef.current);
      exitLineRef.current = null;
    }

    const markers: SeriesMarker<UTCTimestamp>[] = [];

    if (entryTimestamp) {
      const match = findMarkerCandle(series, entryTimestamp, intervalValue);
      if (match) {
        const timeSec = Math.floor(match.candle.openTime / 1000) as UTCTimestamp;
        markers.push({
          time: timeSec,
          position: 'aboveBar',
          color: '#ffd700',
          shape: 'circle',
          text: 'Entry',
        });
        entryLineRef.current = seriesApi.createPriceLine({
          price: match.price,
          color: '#ffd700',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Entry',
        });
      }
    }

    if (exitTimestamp) {
      const match = findMarkerCandle(series, exitTimestamp, intervalValue, exitPrice);
      if (match) {
        const timeSec = Math.floor(match.candle.openTime / 1000) as UTCTimestamp;
        markers.push({
          time: timeSec,
          position: 'belowBar',
          color: '#ff6b6b',
          shape: 'arrowDown',
          text: 'Exit',
        });
        exitLineRef.current = seriesApi.createPriceLine({
          price: match.price,
          color: '#ff6b6b',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Exit',
        });
      }
    }

    markers.sort((a, b) => Number(a.time) - Number(b.time));
    seriesApi.setMarkers(markers);
  }, [active, series, entryTimestamp, exitTimestamp, exitPrice, intervalValue]);

  if (!active) {
    return null;
  }

  const latest = series.length ? series[series.length - 1] : undefined;
  const footerItems: string[] = [`Interval ${intervalLabel}`];
  if (entryTimestamp) footerItems.push(`Entry ${new Date(entryTimestamp).toLocaleString()}`);
  if (exitTimestamp) footerItems.push(`Exit ${new Date(exitTimestamp).toLocaleString()}`);
  if (latest) footerItems.push(`Last close $${latest.close.toFixed(2)}`);
  if (updatedAt) footerItems.push(`Fetched ${new Date(updatedAt).toLocaleString()}`);
  const footerLabel = footerItems.length ? footerItems.join(' | ') : 'Updated —';

  return (
    <div style={{ position: 'relative' }}>
      {loading && <div className="muted" style={{ position: 'absolute', top: 8, right: 16, zIndex: 2 }}>Loading...</div>}
      {error && <div style={{ marginBottom: 8, color: '#ff6b6b' }}>{error}</div>}
      <div ref={containerRef} style={{ width: '100%', height: HEIGHT }} />
      <div className="muted" style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span>{symbol} · TradingView Lightweight {intervalLabel}</span>
        <span>{footerLabel}</span>
      </div>
    </div>
  );
}

export default SpotPriceChart;
