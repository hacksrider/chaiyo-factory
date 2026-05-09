/**
 * SSE event name constants — single source of truth for all SSE event names.
 *
 * Used by:
 *   - useRealtimeSync.js  (subscribes to these events on the EventSource)
 *   - index.jsx           (dispatches handlers for production_updated, session_confirmed)
 *   - LedSignView.jsx     (subscribes to led_updated, production_updated)
 *   - Laravel SSE stream  (emits `event: <name>` with matching values)
 *
 * Laravel emit pattern:
 *   echo "event: production_updated\n";
 *   echo "data: " . json_encode($payload) . "\n\n";
 */
export const SSE_EVENTS = {
  /** Sent once on connect: { latestId } */
  CONNECTED:          'connected',

  /** Machine session state changed (mode, orderId, counters…): { machineId, state } */
  MACHINE_SESSION:    'machine_session',

  /** LED display config changed — legacy name kept for backward compat: { machineId, state } */
  LED_STATE:          'led_state',

  /** LED display config changed — new canonical name: { machineId, ledConfig } */
  LED_UPDATED:        'led_updated',

  /** ESP32 scale reported a new weight; GAS write completed: { machineId, qty_good, qty_remaining, total_weight, _ts } */
  PRODUCTION_UPDATED: 'production_updated',

  /** Operator confirmed on scale (D-button pressed): { machineId, shift, employee_id, confirmed_at } */
  SESSION_CONFIRMED:  'session_confirmed',

  /** Keep-alive from server every 15s — resets heartbeat watchdog on client: no payload (SSE comment `": heartbeat"`) */
  HEARTBEAT:          'heartbeat',

  /** Raw weight submitted by scale ESP32 (real-time button press): { machineId, event } */
  SCALE_WEIGHT:       'scale_weight',

  /** DB queue changed (add/remove): { machineId, action, item?, itemId? } */
  QUEUE_UPDATED:      'queue_updated',

  /** DB session changed (start/pause/finish/confirm): { machineId, session } */
  SESSION_UPDATED:    'session_updated',
};

export default SSE_EVENTS;
