/** เวลาที่โรงงาน (ไทย) — ไม่พึ่ง timezone ของเครื่องผู้ใช้ */
export const PRODUCTION_TZ = 'Asia/Bangkok';

const bangkokYmdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PRODUCTION_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD ตามปฏิทินโรงงาน (GMT+7) */
export function todayBangkokIso(now = new Date()) {
  const parts = bangkokYmdFormatter.formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (y && m && d) return `${y}-${m}-${d}`;
  return bangkokYmdFormatter.format(now);
}

/** วันก่อนหน้า (ปฏิทินโรงงาน) */
export function yesterdayBangkokIso(now = new Date()) {
  const today = todayBangkokIso(now);
  const startMs = bangkokDayStartUtcMs(today);
  if (startMs == null) return today;
  return todayBangkokIso(new Date(startMs - 86_400_000));
}

/** พ.ศ. ใน Sheet → ค.ศ. */
function gregorianYear(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return null;
  if (n >= 2400) return n - 543;
  return n;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** คืน YYYY-MM-DD หรือ null — รองรับรูปแบบจาก Daily sheet */
export function normalizePlanDateKey(raw) {
  if (raw == null || raw === '') return null;

  if (raw instanceof Date) {
    return todayBangkokIso(raw);
  }

  const s = String(raw).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = gregorianYear(Number(m[1]));
    if (y == null) return null;
    return `${y}-${pad2(m[2])}-${pad2(m[3])}`;
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const y = gregorianYear(Number(m[3]));
    if (y == null) return null;
    return `${y}-${pad2(m[2])}-${pad2(m[1])}`;
  }

  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const y = gregorianYear(Number(m[3]));
    if (y == null) return null;
    return `${y}-${pad2(m[2])}-${pad2(m[1])}`;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return normalizePlanDateKey(s.slice(0, 10));
  }

  const d = parseProductionInstant(s.length === 10 ? `${s}T12:00:00+07:00` : s);
  if (d) return todayBangkokIso(d);

  return null;
}

/** แปลง instant หรือสตริงวันที่ → YYYY-MM-DD ในเขตไทย */
export function toBangkokDateStr(raw) {
  return normalizePlanDateKey(raw);
}

/** -1 = a ก่อน b, 0 = เท่ากัน, 1 = a หลัง b, null = เปรียบเทียบไม่ได้ */
export function compareBangkokDates(a, b) {
  const ka = normalizePlanDateKey(a);
  const kb = normalizePlanDateKey(b);
  if (!ka || !kb) return null;
  const ams = bangkokDayStartUtcMs(ka);
  const bms = bangkokDayStartUtcMs(kb);
  if (ams == null || bms == null) return null;
  if (ams < bms) return -1;
  if (ams > bms) return 1;
  return 0;
}

export function isBangkokDateBefore(a, b) {
  const c = compareBangkokDates(a, b);
  return c != null && c < 0;
}

export function isBangkokDateAfter(a, b) {
  const c = compareBangkokDates(a, b);
  return c != null && c > 0;
}

const bangkokWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PRODUCTION_TZ,
  weekday: 'short',
});

const WEEKDAY_TO_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** 0=อา. … 6=ส. สำหรับคีย์ YYYY-MM-DD (ไม่ขึ้น timezone เครื่อง) */
export function bangkokWeekdayIndex(yyyyMmDd) {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return 0;
  const label = bangkokWeekdayFormatter.format(new Date(`${yyyyMmDd}T12:00:00+07:00`));
  return WEEKDAY_TO_INDEX[label] ?? 0;
}

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
