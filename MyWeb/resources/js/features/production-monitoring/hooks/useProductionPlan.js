import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchProductionPlan } from '../api/productionApi';

// ─── Module-level cache ───────────────────────────────────────────────────────
// Shared across all hook instances — survives component re-mounts.
// Key: machineId string | '__all__'
// Value: { orders: [], timestamp: number }

const planCache   = new Map();
const CACHE_TTL   = 5 * 60 * 1000; // 5 minutes

function getCached(machineId) {
  const key    = machineId || '__all__';
  const entry  = planCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) { planCache.delete(key); return null; }
  return entry;
}

function setCached(machineId, orders) {
  planCache.set(machineId || '__all__', { orders, timestamp: Date.now() });
}

export function invalidatePlanCache(machineId) {
  if (machineId) planCache.delete(machineId);
  else planCache.clear();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches and manages production plan data for a given machine.
 *
 * • Results are cached per machineId (5 min TTL) at the module level.
 * • Calling this hook from a parent component acts as a prefetch —
 *   by the time the child renders, data is already in cache.
 */
export const useProductionPlan = ({ machineId = null } = {}) => {
  const cached  = getCached(machineId);

  const [planOrders, setPlanOrders] = useState(cached?.orders ?? []);
  const [loading,    setLoading]    = useState(!cached && !!machineId);
  const [error,      setError]      = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(
    cached ? new Date(cached.timestamp) : null
  );

  const load = useCallback(async (force = false) => {
    if (!machineId) return;

    // Use cache unless forced refresh
    if (!force) {
      const hit = getCached(machineId);
      if (hit) {
        setPlanOrders(hit.orders);
        setLastSyncAt(new Date(hit.timestamp));
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const plan = await fetchProductionPlan({ machine: machineId });
      setCached(machineId, plan);
      setPlanOrders(plan);
      setLastSyncAt(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  // When machineId changes: serve from cache instantly, then background-refresh
  // if cache is stale; otherwise fetch fresh data.
  useEffect(() => {
    if (!machineId) {
      setPlanOrders([]);
      setLoading(false);
      return;
    }

    const hit = getCached(machineId);
    if (hit) {
      // Instant from cache
      setPlanOrders(hit.orders);
      setLastSyncAt(new Date(hit.timestamp));
      setLoading(false);
    } else {
      // Nothing cached yet → fetch
      load();
    }
  }, [machineId, load]);

  // ── Derived data ─────────────────────────────────────────────────────────────

  const inprocessOrders = useMemo(
    () => planOrders.filter((o) => String(o.status ?? '').trim() === 'Inprocess'),
    [planOrders],
  );

  const completeOrders = useMemo(
    () => planOrders.filter((o) => String(o.status ?? '').trim() === 'Complete'),
    [planOrders],
  );

  const availableMonths = useMemo(() => {
    const set = new Set();
    completeOrders.forEach((o) => { if (o.month) set.add(Number(o.month)); });
    return Array.from(set).sort((a, b) => a - b);
  }, [completeOrders]);

  return {
    planOrders,
    inprocessOrders,
    completeOrders,
    availableMonths,
    loading,
    error,
    lastSyncAt,
    // refresh forces a fresh fetch and updates cache
    refresh: () => load(true),
  };
};
