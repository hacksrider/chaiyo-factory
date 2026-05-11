/** เวลาที่โรงงาน (ไทย) — ไม่พึ่ง timezone ของเครื่องผู้ใช้ */
export const PRODUCTION_TZ = 'Asia/Bangkok';

export function parseProductionInstant(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** วัน–เวลาเต็ม (ปฏิทินไทย + เวลาใน GMT+7) */
export function formatProductionDateTimeBangkok(v, opts = {}) {
  const {
    dateStyle = 'short',
    timeStyle = 'medium',
  } = opts;
  const d = parseProductionInstant(v);
  if (!d) return '—';
  return d.toLocaleString('th-TH', {
    timeZone: PRODUCTION_TZ,
    dateStyle,
    timeStyle,
  });
}

export function formatProductionTimeBangkok(v) {
  const d = parseProductionInstant(v);
  if (!d) return '—';
  return d.toLocaleTimeString('th-TH', {
    timeZone: PRODUCTION_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatProductionDateBangkok(v) {
  const d = parseProductionInstant(v);
  if (!d) return '';
  return d.toLocaleDateString('th-TH', {
    timeZone: PRODUCTION_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** ฟิลเตอร์วันที่ YYYY-MM-DD = เริ่มวันเขตไทย */
export function bangkokDayStartUtcMs(yyyyMmDd) {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  return new Date(`${yyyyMmDd}T00:00:00+07:00`).getTime();
}

export function bangkokDayEndUtcMs(yyyyMmDd) {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  return new Date(`${yyyyMmDd}T23:59:59.999+07:00`).getTime();
}
