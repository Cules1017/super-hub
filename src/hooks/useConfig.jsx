import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { apiFetchAll } from '../config/api.js';

const ConfigContext = createContext(null);

const DEFAULT_POLL_MS = 60_000;

/**
 * Provider quản lý toàn bộ state từ Tab Settings + LiveScore.
 * - Fetch khi mount.
 * - Cho phép polling tự động với chu kỳ đọc từ settings (`poll_interval_ms`).
 */
export function ConfigProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    settings: {},
    liveScore: [],
    lastUpdated: 0,
  });

  const abortRef = useRef(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const data = await apiFetchAll(ac.signal);
      setState((s) => ({
        ...s,
        loading: false,
        error: null,
        settings: data.settings || {},
        liveScore: Array.isArray(data.liveScore) ? data.liveScore : [],
        lastUpdated: data.ts || Date.now(),
      }));
    } catch (err) {
      if (err.name === 'AbortError') return;
      setState((s) => ({ ...s, loading: false, error: String(err.message || err) }));
    }
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    const ms = Number(state.settings.poll_interval_ms) || DEFAULT_POLL_MS;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(load, Math.max(ms, 15_000));
    return () => clearInterval(pollRef.current);
  }, [state.settings.poll_interval_ms, load]);

  useEffect(() => {
    const color = state.settings.primary_color;
    const accent = state.settings.accent_color;
    if (color) document.documentElement.style.setProperty('--brand', color);
    if (accent) document.documentElement.style.setProperty('--accent', accent);
  }, [state.settings.primary_color, state.settings.accent_color]);

  const value = useMemo(
    () => ({
      ...state,
      reload: load,
      get: (key, fallback = '') => {
        const v = state.settings?.[key];
        return v === undefined || v === '' ? fallback : v;
      },
    }),
    [state, load]
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within <ConfigProvider>');
  return ctx;
}
