// Small hook for "load data when the page opens": gives { data, error, loading, reload }.
// Re-fetches when any value in `deps` changes and cancels stale requests.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

export function useApi(path, options = {}, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!path) return undefined;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path, { ...optsRef.current, signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
