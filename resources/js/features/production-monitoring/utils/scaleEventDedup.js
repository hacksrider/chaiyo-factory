/**
 * Stable key เดียวสำหรับ dedupe scale_weight (SSE vs poll GET scale-weight —
 * pressedAt/eventId shape ต่างกันได้เล็กน้อย ทำให้ต้อง normalize)
 *
 * @param {object} ev
 * @returns {string}
 */
export function scaleEventDedupKey(ev) {
  if (!ev || typeof ev !== 'object') return '';
  const rawId = ev.eventId ?? ev.event_id ?? ev.id;
  if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
    return `id:${String(rawId)}`;
  }
  const w = Number(ev.weight);
  const wKey = Number.isFinite(w) ? w.toFixed(4) : String(ev.weight ?? '');
  const p = String(ev.pressedAt ?? '').trim();
  const pNorm = p.length >= 19 ? p.slice(0, 19) : p;
  const typ = ev.type === 'ng' ? 'ng' : 'good';
  return `${pNorm}_${wKey}_${typ}`;
}
