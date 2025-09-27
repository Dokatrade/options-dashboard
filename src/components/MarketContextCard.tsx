import React from 'react';

const INTERVAL_PRESETS = [
  { label: '15m', value: '15' as const },
  { label: '1h', value: '60' as const },
  { label: '4h', value: '240' as const },
  { label: '1d', value: '1440' as const },
] as const;
type IntervalValue = typeof INTERVAL_PRESETS[number]['value'];

export function MarketContextCard() {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const widgetContainerRef = React.useRef<HTMLDivElement>(null);
  const [chartTheme, setChartTheme] = React.useState<'light' | 'dark'>('light');
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [interval, setInterval] = React.useState<IntervalValue>('240');

  // Keep the TradingView theme aligned with the OS preference.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (matches: boolean) => setChartTheme(matches ? 'dark' : 'light');
    apply(mql.matches);
    const handler = (event: MediaQueryListEvent) => apply(event.matches);
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

  // Render the TradingView chart and recreate it when the theme changes.
  React.useEffect(() => {
    const container = widgetContainerRef.current;
    if (!container) return;
    container.innerHTML = '';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    container.appendChild(widget);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: 'BYBIT:ETHUSDT',
      interval,
      timezone: 'Europe/Moscow',
      theme: chartTheme,
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
        'use_localstorage_for_settings',
        'save_chart_properties_to_local_storage',
        'save_indicators_to_local_storage',
        'save_drawings_to_local_storage',
        'left_toolbar',
        'header_symbol_search',
      ],
      support_host: 'https://www.tradingview.com',
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [chartTheme, interval]);

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
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    } else {
      if (wrapperRef.current.requestFullscreen) {
        wrapperRef.current.requestFullscreen().catch(() => {});
      }
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
              onClick={() => setInterval(item.value)}
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
          ref={widgetContainerRef}
          className="tradingview-widget-container"
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
