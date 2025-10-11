import React from 'react';

const INTERVAL_PRESETS = [
  { label: '15m', value: '15' as const },
  { label: '1h', value: '60' as const },
  { label: '4h', value: '240' as const },
  { label: '1d', value: '1440' as const },
] as const;

type IntervalValue = typeof INTERVAL_PRESETS[number]['value'];
type VisibleRange = { from: number; to: number };

const INTERVAL_STORAGE_KEY = 'market-chart-interval';
const RANGE_STORAGE_KEY = 'market-chart-visible-range';

declare global {
  interface Window {
    TradingView?: any;
  }
}

let tradingViewLoader: Promise<void> | null = null;

async function loadTradingView(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.TradingView) return;
  if (!tradingViewLoader) {
    tradingViewLoader = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load TradingView'));
      document.head.appendChild(script);
    }).catch((err) => {
      tradingViewLoader = null;
      throw err;
    });
  }
  await tradingViewLoader;
}

function isIntervalValue(value: string): value is IntervalValue {
  return INTERVAL_PRESETS.some((item) => item.value === value);
}

function normalizeInterval(value: string): IntervalValue | null {
  const upper = value.toUpperCase();
  switch (upper) {
    case '15':
    case '15M':
      return '15';
    case '60':
    case '1H':
      return '60';
    case '240':
    case '4H':
      return '240';
    case '1440':
    case '1D':
    case 'D':
      return '1440';
    default:
      return isIntervalValue(value) ? value : null;
  }
}

function getPreferredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredInterval(): IntervalValue {
  if (typeof window === 'undefined') return '240';
  try {
    const raw = window.localStorage?.getItem(INTERVAL_STORAGE_KEY);
    if (!raw) return '240';
    const normalized = normalizeInterval(raw);
    return normalized ?? '240';
  } catch {
    return '240';
  }
}

function persistInterval(value: IntervalValue) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(INTERVAL_STORAGE_KEY, value);
  } catch {}
}

function readStoredRange(): VisibleRange | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem(RANGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.from === 'number' &&
      typeof parsed.to === 'number' &&
      isFinite(parsed.from) &&
      isFinite(parsed.to)
    ) {
      return { from: parsed.from, to: parsed.to };
    }
  } catch {}
  return null;
}

function persistRange(range: VisibleRange) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(RANGE_STORAGE_KEY, JSON.stringify(range));
  } catch {}
}

export function MarketContextCard() {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const widgetContainerRef = React.useRef<HTMLDivElement>(null);
  const containerIdRef = React.useRef(`tv-advanced-chart-${Math.random().toString(36).slice(2)}`);
  const widgetRef = React.useRef<any>(null);
  const chartReadyRef = React.useRef(false);
  const chartSubscriptionsRef = React.useRef<Array<() => void>>([]);
  const storedRangeRef = React.useRef<VisibleRange | null>(readStoredRange());
  const chartRef = React.useRef<any>(null);

  const [chartTheme, setChartTheme] = React.useState<'light' | 'dark'>(() => getPreferredTheme());
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [interval, setIntervalValue] = React.useState<IntervalValue>(() => readStoredInterval());

  const intervalRef = React.useRef<IntervalValue>(interval);
  intervalRef.current = interval;

  const themeRef = React.useRef<'light' | 'dark'>(chartTheme);
  themeRef.current = chartTheme;

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => setChartTheme(event.matches ? 'dark' : 'light');
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
    } else if (mql.addListener) {
      mql.addListener(handler);
    }
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', handler);
      } else if (mql.removeListener) {
        mql.removeListener(handler);
      }
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      if (typeof window === 'undefined') return;
      await loadTradingView().catch(() => {});
      if (cancelled || !widgetContainerRef.current || !window.TradingView) return;

      if (widgetRef.current) {
        chartSubscriptionsRef.current.forEach((off) => off());
        chartSubscriptionsRef.current = [];
        if (typeof widgetRef.current.remove === 'function') {
          try {
            widgetRef.current.remove();
          } catch {
            /* ignore abnormal teardown */
          }
        }
        widgetRef.current = null;
      }

      const widget = new window.TradingView.widget({
        autosize: true,
        symbol: 'BYBIT:ETHUSDT',
        interval: intervalRef.current,
        timezone: 'Europe/Moscow',
        theme: themeRef.current,
        style: '1',
        locale: 'en',
        allow_symbol_change: false,
        hide_top_toolbar: true,
        hide_side_toolbar: true,
        withdateranges: false,
        details: false,
        hotlist: false,
        calendar: false,
        disabled_features: [
          'left_toolbar',
          'header_symbol_search',
          'header_saveload',
          'header_fullscreen_button',
          'header_settings',
          'study_templates',
        ],
        container_id: containerIdRef.current,
      });

      widgetRef.current = widget;

      const onReady = typeof widget.onChartReady === 'function'
        ? widget.onChartReady.bind(widget)
        : null;

      if (!onReady) {
        // TradingView sometimes returns a lightweight placeholder before script hydration
        // Protect against calling the missing hook to avoid crashing the dashboard.
        chartReadyRef.current = false;
        chartRef.current = null;
        return;
      }

      onReady(() => {
        if (cancelled) return;
        chartReadyRef.current = true;
        const chart = widget.activeChart?.() ?? widget.chart?.();
        if (!chart) return;
        chartRef.current = chart;

        const subs: Array<() => void> = [];

        const savedRange = storedRangeRef.current ?? readStoredRange();
        if (savedRange) {
          chart.setVisibleRange?.(savedRange);
        }

        const intervalSource = chart.onIntervalChanged?.();
        if (intervalSource?.subscribe) {
          const token = intervalSource.subscribe(null, (next: string) => {
            const normalized = typeof next === 'string' ? normalizeInterval(next) : null;
            if (normalized && normalized !== intervalRef.current) {
              intervalRef.current = normalized;
              setIntervalValue(normalized);
              persistInterval(normalized);
            }
          });
          if (token != null && typeof intervalSource.unsubscribe === 'function') {
            subs.push(() => intervalSource.unsubscribe(token));
          }
        }

        const visibleSource = chart.onVisibleRangeChanged?.();
        if (visibleSource?.subscribe) {
          const token = visibleSource.subscribe(null, (range: VisibleRange) => {
            if (!range || typeof range.from !== 'number' || typeof range.to !== 'number') return;
            storedRangeRef.current = range;
            persistRange(range);
          });
          if (token != null && typeof visibleSource.unsubscribe === 'function') {
            subs.push(() => visibleSource.unsubscribe(token));
          }
        }

        const saved = storedRangeRef.current ?? readStoredRange();
        if (saved) chart.setVisibleRange?.(saved);

        chartSubscriptionsRef.current = subs;
      });
    })();

    return () => {
      cancelled = true;
      chartReadyRef.current = false;
      chartRef.current = null;
      chartSubscriptionsRef.current.forEach((off) => off());
      chartSubscriptionsRef.current = [];
      if (widgetRef.current?.remove) {
        try {
          widgetRef.current.remove();
        } catch {
          // noop — TradingView occasionally throws if container already removed
        }
        widgetRef.current = null;
      }
    };
  }, [chartTheme, interval]);

  React.useEffect(() => {
    if (!widgetRef.current || typeof widgetRef.current.changeTheme !== 'function') return;
    widgetRef.current.changeTheme(chartTheme);
  }, [chartTheme]);

  React.useEffect(() => {
    persistInterval(interval);
  }, [interval]);

  React.useEffect(() => {
    const handleChange = () => {
      const el = document.fullscreenElement;
      setIsFullscreen(el === wrapperRef.current);
    };
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggleFullscreen = React.useCallback(() => {
    if (!wrapperRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      wrapperRef.current.requestFullscreen?.().catch(() => {});
    }
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'relative',
        width: '100%',
        height: isFullscreen ? '100vh' : 420,
        display: 'flex',
        flexDirection: 'column',
        background: isFullscreen ? 'var(--card, rgba(15,17,21,0.96))' : 'transparent',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 16px',
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          {INTERVAL_PRESETS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                if (intervalRef.current === item.value) return;
                intervalRef.current = item.value;
                setIntervalValue(item.value);
                persistInterval(item.value);
              }}
              style={{
                border: '1px solid rgba(255,255,255,0.35)',
                background: interval === item.value ? 'rgba(255,255,255,0.92)' : 'transparent',
                color: interval === item.value ? '#111' : '#fff',
                padding: '4px 12px',
                borderRadius: 999,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                transition: 'background 0.15s ease',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          style={{
            border: '1px solid rgba(255,255,255,0.35)',
            background: 'transparent',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: 999,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: isFullscreen ? 0 : 340 }}>
        <div
          id={containerIdRef.current}
          ref={widgetContainerRef}
          className="tradingview-widget-container"
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
