import React from 'react';

export const SLOW_REFRESH_MS = 2 * 60 * 1000;

export type RefreshReason = 'initial' | 'manual' | 'schedule';
export type SlowModeStats = {
  lastUpdated: number | null;
  nextUpdate: number | null;
  refreshing: boolean;
  error?: string;
};

type SlowSubscriber = (reason: RefreshReason) => Promise<void> | void;

type SlowModeContextValue = {
  slowMode: boolean;
  setSlowMode: (value: boolean) => void;
  slowStats: SlowModeStats;
  manualRefresh: () => Promise<void>;
  register: (fn: SlowSubscriber) => () => void;
};

const SlowModeContext = React.createContext<SlowModeContextValue | null>(null);

const PREF_KEY = 'positions-ui-v1';

export function SlowModeProvider({ children }: { children: React.ReactNode }) {
  const [slowMode, setSlowModeState] = React.useState(true);
  const slowModeRef = React.useRef(true);
  const [slowStats, setSlowStats] = React.useState<SlowModeStats>({ lastUpdated: null, nextUpdate: null, refreshing: false });
  const refreshInFlightRef = React.useRef<Promise<void> | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const subscribersRef = React.useRef(new Set<SlowSubscriber>());
  const prefsLoadedRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  const safeSetSlowStats = React.useCallback((updater: (prev: SlowModeStats) => SlowModeStats) => {
    if (!mountedRef.current) return;
    setSlowStats((prev) => updater(prev));
  }, []);

  const persistSlowMode = React.useCallback((value: boolean) => {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      const data = raw ? JSON.parse(raw) : {};
      data.slowMode = value;
      localStorage.setItem(PREF_KEY, JSON.stringify(data));
    } catch {}
  }, []);

  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (typeof data?.slowMode === 'boolean') {
          slowModeRef.current = data.slowMode;
          setSlowModeState(data.slowMode);
        }
      }
    } catch {}
    prefsLoadedRef.current = true;
  }, []);

  const register = React.useCallback((fn: SlowSubscriber) => {
    subscribersRef.current.add(fn);
    return () => {
      subscribersRef.current.delete(fn);
    };
  }, []);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runSubscribers = React.useCallback(async (reason: RefreshReason) => {
    const subs = Array.from(subscribersRef.current);
    if (!subs.length) return;
    let firstError: unknown = null;
    for (const fn of subs) {
      try {
        await fn(reason);
      } catch (err) {
        if (!firstError) firstError = err;
      }
    }
    if (firstError) throw firstError;
  }, []);

  const triggerRefresh = React.useCallback((reason: RefreshReason) => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }
    const job = (async () => {
      safeSetSlowStats((prev) => ({ ...prev, refreshing: true, error: undefined }));
      try {
        await runSubscribers(reason);
        safeSetSlowStats((prev) => ({ ...prev, refreshing: false, lastUpdated: Date.now(), error: undefined }));
      } catch (err) {
        safeSetSlowStats((prev) => ({ ...prev, refreshing: false, error: err instanceof Error ? err.message : 'Refresh failed' }));
        throw err;
      }
    })();
    refreshInFlightRef.current = job.finally(() => {
      refreshInFlightRef.current = null;
    });
    return refreshInFlightRef.current;
  }, [runSubscribers, safeSetSlowStats]);

  const schedule = React.useCallback((delay: number) => {
    clearTimer();
    if (!slowModeRef.current) {
      safeSetSlowStats((prev) => ({ ...prev, nextUpdate: null }));
      return;
    }
    const target = Date.now() + delay;
    safeSetSlowStats((prev) => ({ ...prev, nextUpdate: target }));
    timerRef.current = window.setTimeout(() => {
      triggerRefresh('schedule')
        .catch(() => {})
        .finally(() => {
          if (slowModeRef.current) {
            schedule(SLOW_REFRESH_MS);
          } else {
            safeSetSlowStats((prev) => ({ ...prev, nextUpdate: null }));
          }
        });
    }, delay);
  }, [clearTimer, safeSetSlowStats, triggerRefresh]);

  const setSlowMode = React.useCallback((value: boolean) => {
    slowModeRef.current = value;
    setSlowModeState(value);
    persistSlowMode(value);
  }, [persistSlowMode]);

  React.useEffect(() => {
    if (!prefsLoadedRef.current) return;
    if (slowMode) {
      let cancelled = false;
      triggerRefresh('initial')
        .catch(() => {})
        .finally(() => {
          if (!cancelled && slowModeRef.current) {
            schedule(SLOW_REFRESH_MS);
          }
        });
      return () => {
        cancelled = true;
        clearTimer();
      };
    }
    clearTimer();
    safeSetSlowStats((prev) => ({ ...prev, nextUpdate: null }));
    triggerRefresh('manual').catch(() => {});
  }, [slowMode, triggerRefresh, schedule, clearTimer, safeSetSlowStats]);

  const manualRefresh = React.useCallback(async () => {
    clearTimer();
    safeSetSlowStats((prev) => ({ ...prev, nextUpdate: null }));
    try {
      await triggerRefresh('manual');
    } finally {
      if (slowModeRef.current) {
        schedule(SLOW_REFRESH_MS);
      }
    }
  }, [clearTimer, schedule, triggerRefresh, safeSetSlowStats]);

  const value = React.useMemo<SlowModeContextValue>(() => ({
    slowMode,
    setSlowMode,
    slowStats,
    manualRefresh,
    register,
  }), [manualRefresh, register, slowMode, slowStats, setSlowMode]);

  return (
    <SlowModeContext.Provider value={value}>
      {children}
    </SlowModeContext.Provider>
  );
}

export function useSlowMode() {
  const ctx = React.useContext(SlowModeContext);
  if (!ctx) {
    throw new Error('useSlowMode must be used within SlowModeProvider');
  }
  return ctx;
}
