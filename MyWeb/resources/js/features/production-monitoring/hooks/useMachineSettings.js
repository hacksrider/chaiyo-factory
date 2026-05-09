import { useState, useEffect, useCallback } from 'react';
import { fetchMachineSettings } from '../api/productionApi';

/**
 * Fetches the machine list via the Laravel proxy
 * (GET /api/production-monitor/get-settings) and exposes a `refresh`
 * function for the manual "Sync Settings" button.
 *
 * The raw GAS response is normalised inside `fetchMachineSettings` before
 * it arrives here, so `machines` always contains objects in the internal
 * shape: { id, label, ledIp, sheetName }.
 *
 * Return shape:
 *   {
 *     machines:   Array<{ id, label, ledIp, sheetName }>,
 *     loading:    boolean  – true on first load (sidebar shows skeleton)
 *     syncing:    boolean  – true on manual re-sync (top-bar spinner)
 *     error:      string | null
 *     lastSyncAt: Date | null
 *     refresh:    () => void
 *   }
 */
export const useMachineSettings = () => {
  const [machines, setMachines]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [error, setError]           = useState(null);     // human-readable message
  const [errorRaw, setErrorRaw]     = useState(null);     // raw GAS response body
  const [lastSyncAt, setLastSyncAt] = useState(null);

  const load = useCallback(async (isManualSync = false) => {
    if (isManualSync) {
      setSyncing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    setErrorRaw(null);

    try {
      const data = await fetchMachineSettings();
      setMachines(data);
      setLastSyncAt(new Date());
    } catch (err) {
      console.error('[useMachineSettings] Fetch failed:', err.message);
      setError(err.message);
      setErrorRaw(err.raw ?? null);   // raw GAS HTML / text body for debugging
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  return {
    machines,
    loading,
    syncing,
    error,
    errorRaw,
    lastSyncAt,
    refresh: () => load(true),
  };
};
