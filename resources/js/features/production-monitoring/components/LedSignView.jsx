import React, { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import ProductionViewExitButton from './ProductionViewExitButton';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';
import {
  queueLedCommand,
  getLedStatus,
  getLedHeartbeat,
  rebootLedMulti,
  appendMachineLog,
  fetchMachineLogReporters,
  storeMachineLogReporter,
  deleteMachineLogReporter,
} from '../api/productionApi';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

// Speed 1 (ช้าสุด) → 800ms/px … Speed 10 → 50ms/px (default Arduino) … Speed 15 → 20ms/px
const SPEED_MS = [800, 600, 450, 320, 250, 200, 160, 110, 80, 50, 42, 35, 28, 24, 20];
const WIFI_FAILS_BEFORE_OFFLINE = 2;

const DEFAULT_CONFIG = { text: '', colorHex: '#00ffff', fontSize: 1, scrollSpeed: 10 };

function buildLedConfigSignature(cfg) {
  if (!cfg) return '';
  const t = String(cfg.text ?? '').trim();
  if (!t) return '';
  const { r, g, b } = hexToRgb(cfg.colorHex ?? '#00ffff');
  const speedMs = SPEED_MS[(cfg.scrollSpeed ?? 10) - 1] ?? 50;
  return `${t}|${r},${g},${b}|${cfg.fontSize ?? 1}|${speedMs}`;
}

function buildClockPayload(colorHex, cfg = {}) {
  const { r, g, b } = hexToRgb(colorHex ?? '#00ff00');
  const speedMs = SPEED_MS[(cfg.scrollSpeed ?? 10) - 1] ?? 50;
  return {
    text: '',
    showClock: true,
    r,
    g,
    b,
    fontSize: cfg.fontSize ?? 1,
    speed: speedMs,
    actual: '0',
    target: '0',
  };
}

function buildClockSignature(colorHex) {
  const { r, g, b } = hexToRgb(colorHex ?? '#00ff00');
  return `|CLOCK|${r},${g},${b}|`;
}

function formatPreviewClock(now = new Date()) {
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h} : ${m} : ${s}`;
}

function collectRebootIps(localIp, sheetIp) {
  const ips = [];
  const add = (ip) => {
    const trimmed = String(ip ?? '').trim();
    if (trimmed && !ips.includes(trimmed)) ips.push(trimmed);
  };
  add(localIp);
  String(sheetIp ?? '').split(',').forEach((part) => add(part));
  return ips;
}

function serverStateToSignature(st) {
  if (!st || !String(st.text ?? '').trim()) return '';
  const t = String(st.text).trim();
  const r = st.r ?? 0, g = st.g ?? 255, b = st.b ?? 255;
  const fs = st.fontSize ?? 1;
  const ms = Number(st.speed) || 50;
  return `${t}|${r},${g},${b}|${fs}|${ms}`;
}

function speedMsToScrollIndex(ms) {
  const n = Number(ms) || 50;
  const i = SPEED_MS.findIndex((v) => v === n);
  if (i >= 0) return Math.min(15, Math.max(1, i + 1));
  let best = 0, bestDiff = 1e9;
  SPEED_MS.forEach((v, idx) => {
    const d = Math.abs(v - n);
    if (d < bestDiff) { bestDiff = d; best = idx; }
  });
  return Math.min(15, Math.max(1, best + 1));
}

// ─── Date/Time helpers for Machine Log sheet ─────────────────────────────────

/** MM/DD/YYYY without leading zeros, e.g. "4/29/2026" */
function formatDateForSheet(d = new Date()) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** "HH:MM" input value → "H:MM:SS AM/PM" e.g. "7:10:00 AM" */
function formatTimeForSheet(timeInput) {
  if (!timeInput) return '';
  const parts = timeInput.split(':');
  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${h12}:${String(minutes).padStart(2, '0')}:00 ${ampm}`;
}

/** Returns current time as "HH:MM" for input[type=time] */
function getCurrentTimeInput() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** dd/m/yy Buddhist Era short — e.g. "28/5/69" */
function formatDateThaiShort(d = new Date()) {
  const beYear = d.getFullYear() + 543;
  return `${d.getDate()}/${d.getMonth() + 1}/${String(beYear).slice(-2)}`;
}

/** HH.MMน. — e.g. "17.28น." */
function formatTimeThaiDot(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}น.`;
}

// ─── LED pixel-width calculator ───────────────────────────────────────────────
const LED_COMBINING = new Set([
  0x0E31,
  0x0E34, 0x0E35, 0x0E36, 0x0E37,
  0x0E38, 0x0E39, 0x0E3A,
  0x0E47,
  0x0E48, 0x0E49, 0x0E4A, 0x0E4B,
  0x0E4C, 0x0E4D, 0x0E4E,
]);

const ETL14_ADVANCE = 7;
/** โซนข้อความบนป้ายจริง: 3 แผ่น P10 (32×16) = 96×16 px */
const LED_PANEL_W_PX = 32;
const LED_NAME_PANELS = 3;
const LED_NAME_ZONE_PX = LED_PANEL_W_PX * LED_NAME_PANELS;
const LED_PANEL_H_PX = 16;

function getLedPx(text) {
  if (!text) return 0;
  let count = 0;
  for (const ch of text) {
    if (!LED_COMBINING.has(ch.codePointAt(0))) count++;
  }
  return count * ETL14_ADVANCE;
}

// ─── Machine Status Options (excluding "เปิด") ────────────────────────────────
const MACHINE_STATUS_OPTIONS = [
  { value: 'ปิด ပိတ်ပါ။',                                   ledText: 'Break Down',       colorHex: '#ff0000' },
  { value: 'ซ่อม ကျိုး',                                    ledText: 'ซ่อม',             colorHex: '#ff0000' },
  { value: 'ตั้งเครื่อง စက်ပစ္စည်းကိုစနစ်ထည့်သွင်းပါ။',    ledText: 'Setup',            colorHex: '#ff66aa' },
  { value: 'แก้งาน ပိုက်ပြဿနာကိုဖြေရှင်းပါ။',              ledText: 'แก้งาน',           colorHex: '#ff8800' },
  { value: 'บำรุงรักษา ထိန်းသိမ်းခြင်း။',                   ledText: 'บำรุงรักษา',       colorHex: '#ff8800' },
  { value: 'เดินงานทดลอง စမ်းသပ်မှု',                       ledText: 'เดินงานทดลอง',     colorHex: '#ff8800' },
  { value: 'อยู่ระหว่างเตรียมการผลิต',                       ledText: 'เตรียมการ',        colorHex: '#0088ff' },
  { value: 'Process Breakdown',                              ledText: 'Break Down',       colorHex: '#ff0000' },
];

// ─── Cause Options (from reference images) ────────────────────────────────────
const CAUSE_OPTIONS = [
  'เครื่องจักรขัดข้อง စက်အာမောင်းကိုဖြေရှင်းနေ',
  'ไฟฟ้าขัดข้อง မီးသျှင်းမီးပြောင',
  'ระบบน้ำขัดข้อง ရေပေးစနစ် ချို့ယွင်းခြင်း။',
  'วัตถุดิบมีปัญหา ပစ္စည်း ထုပ်ဖို့ ပြဿနာရှိ',
  'ท่อขาด หัก แตก ပိုက်ကျိုး',
  'ท่อเป็นจุด ပိုက်က အချက်',
  'ท่อเป็นตุ่ม ပိုက်က အချက်',
  'ท่อผิวลาย အရေပြားပိုက်မ ကောင်းပါ။',
  'เส้นสีแตก အရောင်လိုင်းများ မရှင်းလင်းပါ။',
  'เส้นสีไม่ได้ Center အရောင်လိုင်းသည် ဗဟိုမပြုပါ။',
  'เส้นสีไม่เท่ากัน ရောင်စုံလိုင်းများသည် အရွယ်အစား တူညီကြသည်မဟုတ်ပေ။',
  'เทสแรงดันไม่ผ่าน ဖိအားစမ်းသပ်မှု မအောင်မြင်ပါ။',
  'พนักงานไม่พอ စက်ထိုင်သမားမ လုံလောက်',
  'ช่างไม่พอ စက်ဆရာမ လုံလောက်',
  'ออเดอร์ครบ / รอออเดอร์ အော်ဒါဖြည့်ဆည်း',
  'วัตถุดิบหมด ကော်မရပါ',
  'วันหยุด ปิดเครื่อง နားရက်စက် ပိတ်',
  'รอวัตถุดิบ ကုန်ကြမ်းကို စောင့် နေတာ။',
  'รอช่างปรับฉีด စက်ကို ချိန်ညှိရန် ပညာရှင်ကို စောင့်နေသည်။',
  'เติมเม็ดไม่ทัน အချိန်မီ မထည့်နိုင်ပါ။',
  'เปลี่ยนงาน ပစ္စည်း ပြောင်း',
  'Start Up စတင်ပါ။',
  'ท่อไม่ได้ขนาดหรือ ความหนาไม่ได้ အချိန်နှင့် မမှန်မကန် ဖြစ်နေသည်',
  'ความยาวท่อไม่ได้ขนาด ပိုက်ရှည်ညာ မမှန်မကန်ဖြစ်နေ',
  'เปลี่ยนตะแกรง grille ကိုပြောင်းပါ။',
  'ล้างหัวดาย ပနျ်ဗတ်မိ ငဝ်တ်ငမ်းမာ',
  'ระยะเจาะรูไม่ได้ မှုတ်သောနေရာ မအောင်မြင်ပါ',
  'เม็ดไม่ลงติดคอฮอปเปอร์ Hopper မိပဒ မဟုတ်ပဲ ကုန်ကြမ်းများ',
  'เม็ดไม่ละลาย ပနျ်ဗတ် ပုသ်ကျ မသွားပဲ',
  'เปลี่ยน ยางซีนแวคคั่ม ရုပ် မြောင်းမာ ဖြည်ဆည်းပြောင်း',
  'ลายสกรีนไม่ผ่าน ဝပ်ဆ် မ ရ',
  'เดินตามแผน အစီအစဉ်အတိုင်း ထုတ်လုပ်မှု',
];

// ─── Color presets ────────────────────────────────────────────────────────────
const COLOR_PRESETS = [
  { hex: '#00ffff', label: 'ฟ้า (Cyan)' },
  { hex: '#0088ff', label: 'น้ำเงิน' },
  { hex: '#8844ff', label: 'ม่วงน้ำเงิน' },
  { hex: '#ff00ff', label: 'ม่วงชมพู' },
  { hex: '#ff66aa', label: 'ชมพู' },
  { hex: '#ff0000', label: 'แดง' },
  { hex: '#ff8800', label: 'ส้ม' },
  { hex: '#ffff00', label: 'เหลือง' },
  { hex: '#aaff00', label: 'เขียวเหลือง' },
  { hex: '#00ff00', label: 'เขียว' },
];

// ─── LedFormPopup ─────────────────────────────────────────────────────────────
const LedFormPopup = ({ isOpen, onClose, onConfirm, machine, mState, submitting, confirmError, defaultRecorderName = '' }) => {
  const [status,      setStatus]     = useState('');
  const [cause,       setCause]      = useState('');
  const [team,        setTeam]       = useState('');
  const [reporter,    setReporter]   = useState('');
  const [reporters,   setReporters]  = useState([]);
  const [newRep,      setNewRep]     = useState('');
  const [showAddRep,  setShowAddRep] = useState(false);
  const [ledText,     setLedText]    = useState('');
  const [detail,      setDetail]     = useState('');
  const [fix,         setFix]        = useState('');
  const [timeVal,     setTimeVal]    = useState('');
  const [errors,      setErrors]     = useState({});
  const [causeSearch, setCauseSearch] = useState('');
  const [causeOpen,   setCauseOpen]   = useState(false);
  const causeRef = useRef(null);
  const [reporterSearch, setReporterSearch] = useState('');
  const [reporterOpen,   setReporterOpen]   = useState(false);
  const reporterRef = useRef(null);
  const [reportersLoading, setReportersLoading] = useState(false);
  const [reporterSaveError, setReporterSaveError] = useState('');

  // โหลดรายชื่อผู้ลงข้อมูลจาก database เมื่อเปิด popup
  useEffect(() => {
    if (isOpen) {
      setReporters([]);
      setReportersLoading(true);
      fetchMachineLogReporters()
        .then((list) => setReporters(list))
        .catch(() => setReporters([]))
        .finally(() => setReportersLoading(false));
      setTimeVal(getCurrentTimeInput());
      // Reset form
      setStatus('');
      setCause('');
      setTeam('');
      setReporter(String(defaultRecorderName ?? '').trim());
      setLedText('');
      setDetail('');
      setFix('');
      setErrors({});
      setCauseSearch('');
      setCauseOpen(false);
      setReporterSearch('');
      setReporterOpen(false);
      setShowAddRep(false);
      setNewRep('');
      setReporterSaveError('');
    }
  }, [isOpen, defaultRecorderName]);

  // When status changes → auto-fill LED text
  useEffect(() => {
    const found = MACHINE_STATUS_OPTIONS.find(o => o.value === status);
    if (found) setLedText(found.ledText);
  }, [status]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (causeRef.current && !causeRef.current.contains(e.target)) {
        setCauseOpen(false);
      }
      if (reporterRef.current && !reporterRef.current.contains(e.target)) {
        setReporterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addReporter = async () => {
    const name = newRep.trim();
    if (!name) return;
    if (reporters.some((r) => r.name === name)) {
      setNewRep('');
      setShowAddRep(false);
      return;
    }
    setReporterSaveError('');
    try {
      const row = await storeMachineLogReporter(name);
      setReporters((prev) =>
        [...prev, row].sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'))
      );
      setNewRep('');
      setShowAddRep(false);
    } catch (err) {
      setReporterSaveError(err?.message ?? 'บันทึกชื่อไม่สำเร็จ');
    }
  };

  const removeReporter = async (id, name) => {
    try {
      await deleteMachineLogReporter(id);
      setReporters((prev) => prev.filter((r) => r.id !== id));
      if (reporter === name) setReporter('');
    } catch {
      /* ignore */
    }
  };

  const filteredCauses = CAUSE_OPTIONS.filter(c =>
    !causeSearch || c.toLowerCase().includes(causeSearch.toLowerCase())
  );

  const filteredReporters = reporters.filter((r) =>
    !reporterSearch || String(r.name).toLowerCase().includes(reporterSearch.toLowerCase())
  );

  const validate = () => {
    const e = {};
    if (!status)   e.status   = 'กรุณาเลือกสถานะ';
    if (!team)     e.team     = 'กรุณาเลือกกะ';
    if (!reporter.trim()) e.reporter = 'กรุณาระบุผู้ลงข้อมูล';
    if (!ledText.trim())  e.ledText  = 'กรุณาระบุข้อความบนป้ายไฟ';
    return e;
  };

  const handleConfirm = () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    const now = new Date();
    onConfirm({
      machine:     machine?.label ?? machine?.id ?? '',
      date:        formatDateForSheet(now),
      status,
      time:        formatTimeForSheet(timeVal) || formatTimeForSheet(getCurrentTimeInput()),
      cause,
      team,
      reporter:    reporter.trim(),
      ledText:     ledText.trim(),
      detail:      detail.trim(),
      fix:         fix.trim(),
      productCode: mState?.productCode ?? '',
      colorHex:    MACHINE_STATUS_OPTIONS.find(o => o.value === status)?.colorHex ?? '#ff0000',
    });
  };

  if (!isOpen) return null;

  const inputCls = 'w-full bg-gray-800/80 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/70';
  const labelCls = 'text-xs text-gray-400 font-medium mb-1 block';
  const errCls   = 'text-[10px] text-red-400 mt-0.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-base font-bold text-white">เปลี่ยนข้อความบนป้ายไฟ</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {machine?.label ?? machine?.id ?? ''}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center transition-all disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* เวลา — defaults to now, editable */}
          <div>
            <label className={labelCls}>เวลา (အချိန်)</label>
            <input
              type="time"
              value={timeVal}
              onChange={e => setTimeVal(e.target.value)}
              className={inputCls}
            />
            <p className="text-[10px] text-gray-600 mt-0.5">จะบันทึกในรูปแบบ {formatTimeForSheet(timeVal) || '—'}</p>
          </div>

          {/* 2.1 สถานะเครื่องจักร — required */}
          <div>
            <label className={labelCls}>
              สถานะเครื่องจักร (စက်အခြေအနေ) <span className="text-red-400">*</span>
            </label>
            <select
              value={status}
              onChange={e => { setStatus(e.target.value); setErrors(v => ({ ...v, status: '' })); }}
              className={`${inputCls} ${errors.status ? 'border-red-500/60' : ''}`}
            >
              <option value="">-- เลือกสถานะ --</option>
              {MACHINE_STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.value}</option>
              ))}
            </select>
            {errors.status && <p className={errCls}>{errors.status}</p>}
          </div>

          {/* 2.2 สาเหตุ — searchable dropdown + free type */}
          <div>
            <label className={labelCls}>สาเหตุ (အကြောင်းရင်း)</label>
            <div ref={causeRef} className="relative">
              <input
                type="text"
                value={cause}
                onChange={e => { setCause(e.target.value); setCauseSearch(e.target.value); setCauseOpen(true); }}
                onFocus={() => { setCauseSearch(''); setCauseOpen(true); }}
                placeholder="เลือกหรือพิมพ์สาเหตุ..."
                className={inputCls}
              />
              {/* Dropdown trigger */}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setCauseOpen(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white px-1"
              >▾</button>
              {causeOpen && (
                <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-52 overflow-y-auto">
                  {/* Search inside dropdown */}
                  <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-2 py-1.5">
                    <input
                      type="text"
                      value={causeSearch}
                      onChange={e => setCauseSearch(e.target.value)}
                      placeholder="ค้นหา..."
                      className="w-full bg-gray-700/60 border-0 rounded px-2 py-1 text-xs text-white placeholder:text-gray-500 focus:outline-none"
                      autoFocus
                    />
                  </div>
                  {filteredCauses.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setCause(c); setCauseOpen(false); setCauseSearch(''); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
                    >
                      {c}
                    </button>
                  ))}
                  {filteredCauses.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-500">ไม่พบรายการ</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 2.3 เลือกกะ — required */}
          <div>
            <label className={labelCls}>
              เลือกกะ (Team) <span className="text-red-400">*</span>
            </label>
            <select
              value={team}
              onChange={e => { setTeam(e.target.value); setErrors(v => ({ ...v, team: '' })); }}
              className={`${inputCls} ${errors.team ? 'border-red-500/60' : ''}`}
            >
              <option value="">-- เลือกกะ --</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </select>
            {errors.team && <p className={errCls}>{errors.team}</p>}
          </div>

          {/* 2.4 ผู้ลงข้อมูล — required, with saved reporters */}
          <div>
            <label className={labelCls}>
              ผู้ลงข้อมูล (စာရင်းသွင်းသူ) <span className="text-red-400">*</span>
            </label>
            {reportersLoading && (
              <p className="text-[10px] text-gray-500 mb-1">กำลังโหลดรายชื่อ…</p>
            )}
            {/* Dropdown แบบค้นหาได้ (เหมือนสาเหตุ) */}
            <div ref={reporterRef} className="relative">
              <input
                type="text"
                value={reporter}
                onChange={e => {
                  setReporter(e.target.value);
                  setReporterSearch(e.target.value);
                  setReporterOpen(true);
                  setErrors(v => ({ ...v, reporter: '' }));
                }}
                onFocus={() => { setReporterSearch(''); setReporterOpen(true); }}
                placeholder="เลือกหรือพิมพ์ชื่อผู้ลงข้อมูล..."
                className={`${inputCls} pr-8 ${errors.reporter ? 'border-red-500/60' : ''}`}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setReporterOpen(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white px-1"
              >
                ▾
              </button>
              {reporterOpen && (
                <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-52 overflow-y-auto">
                  <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-2 py-1.5">
                    <input
                      type="text"
                      value={reporterSearch}
                      onChange={e => setReporterSearch(e.target.value)}
                      placeholder="ค้นหา..."
                      className="w-full bg-gray-700/60 border-0 rounded px-2 py-1 text-xs text-white placeholder:text-gray-500 focus:outline-none"
                      autoFocus
                    />
                  </div>
                  {filteredReporters.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-1 px-2 py-1 hover:bg-gray-700/80 transition-colors group"
                    >
                      <button
                        type="button"
                        onClick={() => { setReporter(r.name); setReporterOpen(false); setReporterSearch(''); }}
                        className="flex-1 min-w-0 text-left px-1 py-1 text-xs text-gray-300"
                      >
                        <span className="block truncate">{r.name}</span>
                      </button>
                      <button
                        type="button"
                        title="ลบชื่อนี้ออกจากรายการ"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeReporter(r.id, r.name);
                        }}
                        className="flex-shrink-0 w-7 h-7 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-500/15 text-sm leading-none flex items-center justify-center"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {filteredReporters.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-500">ไม่พบรายการ</p>
                  )}
                </div>
              )}
            </div>
            {errors.reporter && <p className={errCls}>{errors.reporter}</p>}
            {/* Add to saved list */}
            {!showAddRep ? (
              <button
                type="button"
                onClick={() => { setNewRep(reporter); setShowAddRep(true); }}
                className="mt-1.5 text-[11px] text-indigo-400 hover:text-indigo-200 transition-colors"
              >
                + บันทึกชื่อนี้ไว้ในรายการ
              </button>
            ) : (
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="text"
                  value={newRep}
                  onChange={e => setNewRep(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addReporter(); } }}
                  placeholder="ชื่อที่ต้องการบันทึก"
                  className="flex-1 bg-gray-800/80 border border-indigo-500/50 rounded px-2 py-1 text-xs text-white focus:outline-none"
                  autoFocus
                />
                <button type="button" onClick={() => addReporter()} className="text-xs text-green-400 hover:text-green-200 px-2 py-1 border border-green-500/30 rounded transition-colors">บันทึก</button>
                <button type="button" onClick={() => { setShowAddRep(false); setReporterSaveError(''); }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">ยกเลิก</button>
              </div>
            )}
            {reporterSaveError && (
              <p className="text-[10px] text-red-400 mt-1">{reporterSaveError}</p>
            )}
          </div>

          {/* 2.6 รายละเอียด */}
          <div>
            <label className={labelCls}>รายละเอียด (အသေးစိတ်)</label>
            <textarea
              value={detail}
              onChange={e => setDetail(e.target.value)}
              rows={2}
              placeholder="รายละเอียดเพิ่มเติม..."
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* 2.7 การแก้ไข */}
          <div>
            <label className={labelCls}>การแก้ไข (ပြင်ဆင်ရန်)</label>
            <textarea
              value={fix}
              onChange={e => setFix(e.target.value)}
              rows={2}
              placeholder="วิธีการแก้ไข..."
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* Preview */}
          <div>
            <label className={labelCls}>ตัวอย่างบนป้ายไฟ</label>
            <LedPreview
              text={ledText}
              colorHex={MACHINE_STATUS_OPTIONS.find(o => o.value === status)?.colorHex ?? '#ff0000'}
              speed={10}
            />
          </div>

          {/* ข้อความบนป้ายไฟ — required, defaults from status (ย้ายไว้ล่างสุด) */}
          <div>
            <label className={labelCls}>
              ข้อความบนป้ายไฟ (ဆိုင်းဘုတ်စာသား) <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={ledText}
              onChange={e => { setLedText(e.target.value); setErrors(v => ({ ...v, ledText: '' })); }}
              placeholder="ข้อความที่จะแสดงบนป้ายไฟ"
              className={`${inputCls} ${errors.ledText ? 'border-red-500/60' : ''}`}
            />
            {errors.ledText && <p className={errCls}>{errors.ledText}</p>}
          </div>

          {/* Error from server */}
          {confirmError && (
            <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {confirmError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-4 border-t border-gray-800">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 transition-all disabled:opacity-40"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
              submitting
                ? 'bg-indigo-500/30 text-indigo-400 cursor-wait'
                : 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/30 hover:border-indigo-400/60'
            }`}
          >
            {submitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                กำลังบันทึก...
              </>
            ) : (
              'ยืนยัน'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── QuickLedPopup ────────────────────────────────────────────────────────────
// เปลี่ยนข้อความป้ายไฟอย่างเดียว — ไม่บันทึกสถานะเครื่องจักรลง Sheet
const QuickLedPopup = ({ isOpen, onClose, onConfirm, machine, currentConfig, submitting, confirmError, recorderName = '' }) => {
  const [text,        setText]       = useState('');
  const [showSuffix,  setShowSuffix] = useState(true);
  const [errors,      setErrors]     = useState({});

  // ตั้งค่าเริ่มต้นเฉพาะตอนเปิด popup — ตัด suffix ออกจาก input ให้ผู้ใช้เห็นแค่ข้อความหลัก
  useEffect(() => {
    if (!isOpen) return;
    const raw = currentConfig?.text ?? '';
    const sepIdx = raw.indexOf(' |- ');
    setText(sepIdx >= 0 ? raw.substring(0, sepIdx).trim() : raw.trim());
    setShowSuffix(true);
    setErrors({});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per open
  }, [isOpen]);

  const suffixPreview = showSuffix && recorderName
    ? ` |- ${recorderName} ${formatDateThaiShort()} - ${formatTimeThaiDot()}`
    : '';
  const previewText = text.trim() ? text.trim() + suffixPreview : '';

  const handleConfirm = () => {
    if (!text.trim()) { setErrors({ text: 'กรุณาระบุข้อความ' }); return; }
    onConfirm({ text: text.trim(), showSuffix });
  };

  if (!isOpen) return null;

  const inputCls = 'w-full bg-gray-800/80 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/70';
  const labelCls = 'text-xs text-gray-400 font-medium mb-1 block';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-gray-700/60 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              เปลี่ยนข้อความป้ายไฟ
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {machine?.label ?? machine?.id ?? ''} · ไม่บันทึกสถานะเครื่องจักร
            </p>
          </div>
          <button onClick={onClose} disabled={submitting}
            className="w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center transition-all disabled:opacity-40">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto space-y-4 px-5 py-4">
          {/* Preview — แสดงข้อความจริงที่จะส่งไปป้ายรวม suffix */}
          <LedPreview
            text={previewText}
            colorHex={currentConfig?.colorHex ?? '#00ffff'}
            speed={currentConfig?.scrollSpeed ?? 10}
          />

          {/* Text input — ให้พิมพ์เฉพาะข้อความหลัก suffix ไม่ต้องพิมพ์ */}
          <div>
            <label className={labelCls}>ข้อความบนป้ายไฟ <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={text}
              onChange={e => { setText(e.target.value); setErrors({}); }}
              placeholder="พิมพ์ข้อความที่ต้องการแสดง..."
              className={`${inputCls} ${errors.text ? 'border-red-500/60' : ''}`}
              autoFocus
            />
            {errors.text && <p className="text-[10px] text-red-400 mt-0.5">{errors.text}</p>}
          </div>

          {/* Checkbox แสดงชื่อ/วันที่/เวลา */}
          {recorderName && (
            <label className="flex items-start gap-2.5 cursor-pointer select-none group">
              <div className="relative flex-shrink-0 mt-0.5">
                <input
                  type="checkbox"
                  checked={showSuffix}
                  onChange={e => setShowSuffix(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                  showSuffix
                    ? 'bg-cyan-500 border-cyan-500'
                    : 'bg-transparent border-gray-500 group-hover:border-gray-400'
                }`}>
                  {showSuffix && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-300 font-medium leading-tight">แสดงชื่อ / วันที่ / เวลา ท้ายข้อความ</p>
                {showSuffix ? (
                  <p className="text-[10px] text-cyan-400/70 font-mono mt-0.5 break-all leading-relaxed">
                    {text.trim() || '…'}<span className="text-gray-500">{suffixPreview}</span>
                  </p>
                ) : (
                  <p className="text-[10px] text-gray-600 mt-0.5">ส่งเฉพาะข้อความ ไม่มีชื่อ/วันที่</p>
                )}
              </div>
            </label>
          )}

          <p className="text-[11px] text-gray-600">
            ใช้ <span className="text-gray-400 font-semibold">สี / ความเร็ว / ฟอนต์เดิม</span> ของเครื่องนี้
          </p>

          {confirmError && (
            <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {confirmError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center gap-3 border-t border-gray-800 px-5 py-4">
          <button onClick={onClose} disabled={submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 transition-all disabled:opacity-40">
            ยกเลิก
          </button>
          <button onClick={handleConfirm} disabled={submitting}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
              submitting
                ? 'bg-cyan-500/30 text-cyan-400 cursor-wait'
                : 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30 hover:border-cyan-400/60'
            }`}>
            {submitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                กำลังส่ง...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                ส่งไปป้ายไฟ
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── StatusBadge ──────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  const map = {
    idle:    { cls: 'bg-gray-700/60 text-gray-400 border-gray-600/30',       label: t('production.ledQueueIdle') },
    pinging: { cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', label: t('production.ledQueueSending') },
    ok:      { cls: 'bg-green-500/20  text-green-400  border-green-500/30',  label: t('production.ledQueuedOk') },
    error:   { cls: 'bg-red-500/20    text-red-400    border-red-500/30',    label: t('production.ledQueueError') },
    noip:    { cls: 'bg-gray-700/40   text-gray-500   border-gray-700/30',   label: t('production.ledQueueNoIp') },
  };
  const { cls, label } = map[status] ?? map.idle;
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${cls}`}>
      {label}
    </span>
  );
};

// ─── LedPreview ───────────────────────────────────────────────────────────────
const LedPreview = ({ text, colorHex, speed = 10, showClock = false }) => {
  const textRef = useRef(null);
  const [textW, setTextW] = useState(0);
  const [clockText, setClockText] = useState(() => formatPreviewClock());
  const boxW = LED_NAME_ZONE_PX;
  const fs = 10;

  useEffect(() => {
    if (!showClock) return undefined;
    setClockText(formatPreviewClock());
    const id = setInterval(() => setClockText(formatPreviewClock()), 1000);
    return () => clearInterval(id);
  }, [showClock]);

  const displayText = showClock ? clockText : text;

  useLayoutEffect(() => {
    const el = textRef.current;
    if (el) setTextW(el.scrollWidth);
  }, [displayText, fs]);

  const ledPx      = getLedPx(displayText);
  const isOverflow = !showClock && ledPx > LED_NAME_ZONE_PX;

  const scrollSpeedMs = SPEED_MS[(speed ?? 10) - 1] ?? 50;
  const duration = isOverflow
    ? Math.max(1, (LED_NAME_ZONE_PX + ledPx) * scrollSpeedMs / 1000)
    : 0;

  const kfName = `lm_${ledPx}_${Math.round(textW)}`.replace(/\./g, '_');

  const targetW   = ledPx > 0 ? ledPx : 0;
  const scaleX    = !isOverflow && textW > 0 && targetW > 0 ? targetW / textW : 1;
  const staticLeft = targetW > 0 ? (boxW - targetW) / 2 : 0;

  const baseStyle = {
    display:    'inline-block',
    fontFamily: '"Courier New", monospace',
    fontSize:   `${fs}px`,
    lineHeight:  1,
    color:       colorHex,
    textShadow: `0 0 3px ${colorHex}cc, 0 0 1px ${colorHex}`,
    whiteSpace: 'nowrap',
    fontWeight:  400,
  };

  return (
    <>
      {isOverflow && textW > 0 && (
        <style>{`
          @keyframes ${kfName} {
            from { transform: translateX(${boxW}px); }
            to   { transform: translateX(-${Math.round(textW)}px); }
          }
        `}</style>
      )}
      <div
        className="rounded border border-gray-700/50 shrink-0"
        style={{
          background:     '#080808',
          width:          LED_NAME_ZONE_PX,
          height:         LED_PANEL_H_PX,
          overflow:       'hidden',
          position:       'relative',
          imageRendering: 'pixelated',
        }}
      >
        <div className="absolute inset-0" style={{ overflow: 'hidden' }}>
          {displayText ? (
            isOverflow ? (
              <div className="absolute inset-0 flex items-center">
                <span ref={textRef} style={{
                  ...baseStyle,
                  animation: textW > 0
                    ? `${kfName} ${duration.toFixed(2)}s linear infinite`
                    : 'none',
                }}>
                  {displayText}
                </span>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center">
                <span ref={textRef} style={{
                  ...baseStyle,
                  position:        'absolute',
                  top:             '50%',
                  left:            `${Math.round(staticLeft)}px`,
                  transformOrigin: 'left center',
                  transform:       textW > 0
                    ? `translateY(-50%) scaleX(${scaleX.toFixed(4)})`
                    : 'translateY(-50%)',
                }}>
                  {displayText}
                </span>
              </div>
            )
          ) : (
            <div className="absolute inset-0 flex items-center" style={{ paddingLeft: 2 }}>
              <span style={{ color: '#2a2a2a', fontFamily: 'monospace', fontSize: '7px' }}>
                preview…
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// ─── WiFiBadge ────────────────────────────────────────────────────────────────
const WiFiBadge = ({ status, onReboot, rebooting = false, canReboot = false, compact = false }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const cfg = {
    checking: { dot: 'bg-yellow-400 animate-pulse', text: 'text-yellow-400', label: t('production.ledStatusChecking'), bg: 'bg-yellow-500/10 border-yellow-500/20' },
    online:   { dot: 'bg-green-400',                text: 'text-green-400',  label: t('production.ledStatusOnline'),   bg: 'bg-green-500/10  border-green-500/20'  },
    offline:  { dot: 'bg-red-400 animate-pulse',    text: 'text-red-400',    label: t('production.ledStatusOffline'),  bg: 'bg-red-500/10 border-red-500/20' },
    noip:     { dot: 'bg-gray-500',                 text: 'text-gray-500',   label: t('production.ledStatusNoIp'),     bg: 'bg-gray-700/30 border-gray-600/20' },
  }[status] ?? { dot: 'bg-gray-500', text: 'text-gray-500', label: status, bg: 'bg-gray-700/30 border-gray-600/20' };

  const rebootTitle = status === 'offline'
    ? t('production.ledRebootBoardTitleOffline')
    : t('production.ledRebootBoardTitle');

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${cfg.bg}`}>
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${cfg.dot}`} />
        <span className={`text-[11px] font-semibold leading-none ${cfg.text}`}>{cfg.label}</span>
        {canReboot && (
          <button
            type="button"
            onClick={onReboot}
            disabled={rebooting}
            title={rebootTitle}
            className="ml-0.5 text-[10px] font-semibold text-orange-300 transition-all hover:text-orange-100 disabled:cursor-wait disabled:opacity-40"
          >
            {rebooting ? '…' : 'RST'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${cfg.bg}`}>
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] text-gray-500 uppercase tracking-wide leading-none mb-0.5">{t('production.ledStatusLabel')}</span>
        <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
      </div>
      {canReboot && (
        <button
          type="button"
          onClick={onReboot}
          disabled={rebooting}
          title={rebootTitle}
          className="ml-1 text-[10px] font-semibold text-orange-300 hover:text-orange-100 border border-orange-500/40 hover:border-orange-400/60 px-1.5 py-0.5 rounded transition-all disabled:opacity-40 disabled:cursor-wait flex-shrink-0"
        >
          {rebooting ? '…' : 'RST'}
        </button>
      )}
    </div>
  );
};

const DeviceStat = ({ label, value, valueClass = 'text-white', hint = null }) => (
  <div className="min-w-0 px-4 py-3">
    <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
    <p className={`break-all font-mono text-sm font-semibold leading-snug ${valueClass}`}>{value}</p>
    {hint && <p className="mt-1 text-[10px] text-gray-600">{hint}</p>}
  </div>
);

// ─── ControlPanel ─────────────────────────────────────────────────────────────
const ControlPanel = ({
  machine, config, onChange, onSpeedChange, onOpenPopup, onOpenQuick, onClearLed,
  onReboot, onForceSync, sendStatus, pingStatus, pingMsg, errorMsg,
  wifiStatus = 'noip', syncStatus = 'idle', clearStatus = 'idle', speedForAll, onSpeedForAllChange,
  deviceLocalIp = null, heartbeatSecondsAgo = null, deviceRssi = null, deviceTemp = null,
  showClock = false, rebooting = false,
}) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  const { text, colorHex, scrollSpeed = 10 } = config;
  const hasIp = !!machine?.ledIp;
  const { r, g, b } = hexToRgb(colorHex);
  const [headerClock, setHeaderClock] = useState(() => formatPreviewClock());

  useEffect(() => {
    if (!showClock) return undefined;
    setHeaderClock(formatPreviewClock());
    const id = setInterval(() => setHeaderClock(formatPreviewClock()), 1000);
    return () => clearInterval(id);
  }, [showClock]);
  const otaUrl = deviceLocalIp ? `http://${deviceLocalIp}/update` : null;
  const statusUrl = deviceLocalIp ? `http://${deviceLocalIp}/status` : null;
  const rssiText = deviceRssi == null
    ? null
    : deviceRssi >= -60
      ? t('production.ledWifiRssiGood', { rssi: deviceRssi })
      : deviceRssi >= -75
        ? t('production.ledWifiRssiOk', { rssi: deviceRssi })
        : t('production.ledWifiRssiWeak', { rssi: deviceRssi });
  const rssiClass = deviceRssi == null
    ? 'text-gray-500'
    : deviceRssi >= -60
      ? 'text-green-400'
      : deviceRssi >= -75
        ? 'text-yellow-400'
        : 'text-red-400';

  const cardTone = wifiStatus === 'online'
    ? 'border-cyan-500/20 bg-gradient-to-br from-gray-900/90 via-gray-900/80 to-cyan-950/25'
    : wifiStatus === 'offline'
      ? 'border-red-500/15 bg-gradient-to-br from-gray-900/90 via-gray-900/80 to-red-950/20'
      : 'border-gray-700/50 bg-gray-900/70';

  const syncBtnCls = syncStatus === 'syncing'
    ? 'border-gray-600/30 bg-gray-700/40 text-gray-500 cursor-wait'
    : syncStatus === 'ok'
      ? 'border-green-500/30 bg-green-500/15 text-green-400'
      : syncStatus === 'error'
        ? 'border-red-500/30 bg-red-500/15 text-red-400'
        : 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300 hover:border-indigo-400/40 hover:bg-indigo-500/20';

  return (
    <div className="flex flex-col gap-4">

      {/* ── Device overview (header + telemetry) ── */}
      <div className={`overflow-hidden rounded-2xl border ${cardTone}`}>
        <div className="flex flex-col gap-3 border-b border-white/5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-[10px] uppercase tracking-widest text-gray-500">{machine?.id}</p>
            <h3 className="truncate text-xl font-bold leading-tight text-white sm:text-2xl">
              {machine?.label || machine?.id}
            </h3>
            {machine?.zone && (
              <p className="mt-0.5 truncate text-[11px] text-gray-500">{machine.zone}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <WiFiBadge
              status={wifiStatus}
              onReboot={onReboot}
              rebooting={rebooting}
              canReboot={hasIp || !!deviceLocalIp}
              compact
            />
            {hasIp && config.text && (
              <button
                type="button"
                onClick={onForceSync}
                disabled={syncStatus === 'syncing'}
                title={t('production.ledForceSyncTitle')}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ${syncBtnCls}`}
              >
                {syncStatus === 'syncing' ? t('production.ledSyncSyncing') :
                 syncStatus === 'ok'      ? t('production.ledSyncOk') :
                 syncStatus === 'error'   ? t('production.ledSyncError') :
                 t('production.ledSyncIdle')}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-white/5 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <DeviceStat
            label={t('production.ledWifiIpLabel')}
            value={deviceLocalIp ?? t('production.ledWifiIpUnknown')}
            valueClass={deviceLocalIp ? 'text-cyan-300' : 'text-gray-500'}
            hint={
              heartbeatSecondsAgo != null && wifiStatus === 'online'
                ? t('production.ledOnlineAgo', { ago: heartbeatSecondsAgo })
                : null
            }
          />
          <DeviceStat
            label={t('production.ledWifiRssiLabel')}
            value={rssiText ?? t('production.ledWifiRssiUnknown')}
            valueClass={rssiClass}
          />
          <DeviceStat
            label={t('production.ledDeviceTempLabel')}
            value={deviceTemp != null ? `${deviceTemp.toFixed(1)}°C` : '—'}
            valueClass={deviceTemp != null ? 'text-gray-200' : 'text-gray-500'}
          />
        </div>

        {otaUrl && (
          <div className="flex flex-col gap-2 border-t border-white/5 bg-black/20 px-4 py-2.5 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-2">
              <a
                href={otaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/25"
              >
                {t('production.ledOtaOpen')} → /update
              </a>
              {statusUrl && (
                <a
                  href={statusUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-600/50 bg-gray-800/60 px-3 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-700/60"
                >
                  {t('production.ledDeviceStatusOpen')}
                </a>
              )}
            </div>
            <span className="text-[10px] text-gray-500 sm:ml-auto">{t('production.ledOtaHint')}</span>
          </div>
        )}
      </div>

      {(pingMsg || errorMsg) && (
        <div className={`break-all rounded-xl border px-3 py-2 font-mono text-[11px] ${
          pingStatus === 'ok' || sendStatus === 'ok'
            ? 'border-green-500/20 bg-green-500/10 text-green-400'
            : 'border-red-500/20 bg-red-500/10 text-red-400'
        }`}>
          {pingMsg || errorMsg}
        </div>
      )}

      {/* ── แสดงนาฬิกา (ปุ่มบนสุด) ── */}
      <button
        type="button"
        onClick={onClearLed}
        disabled={!hasIp || clearStatus === 'clearing'}
        className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
          !hasIp
            ? 'bg-gray-700/30 text-gray-600 cursor-not-allowed'
            : clearStatus === 'clearing'
            ? 'bg-emerald-500/30 text-emerald-400 cursor-wait'
            : clearStatus === 'ok'
            ? 'bg-green-500/20 border border-green-500/40 text-green-300'
            : clearStatus === 'error'
            ? 'bg-red-500/20 border border-red-500/40 text-red-300'
            : showClock
            ? 'bg-emerald-500/25 border border-emerald-400/50 text-emerald-100 ring-1 ring-emerald-400/30'
            : 'bg-emerald-500/15 border border-emerald-500/35 text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-400/55'
        }`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {clearStatus === 'clearing'
          ? t('production.ledClearSending')
          : clearStatus === 'ok'
          ? t('production.ledClearOk')
          : t('production.ledClearBtn')}
      </button>

      {/* ── Color Picker ── */}
      <div>
        <label className="text-xs text-gray-400 mb-2 block font-medium">
          {showClock ? t('production.ledClockColor') : t('production.ledTextColor')}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <label className="cursor-pointer flex-shrink-0">
            <input type="color" value={colorHex} onChange={(e) => onChange('colorHex', e.target.value)} className="sr-only" />
            <div
              className="w-10 h-10 rounded-lg border-2 border-white/20 shadow-lg"
              style={{ background: colorHex, boxShadow: `0 0 10px ${colorHex}66` }}
            />
          </label>
          <div className="flex gap-1.5 flex-wrap flex-1">
            {COLOR_PRESETS.map(({ hex, label }) => (
              <button
                key={hex}
                type="button"
                title={label}
                onClick={() => onChange('colorHex', hex)}
                className={`w-7 h-7 rounded-md border-2 transition-all ${
                  colorHex === hex ? 'border-white scale-110 shadow-lg' : 'border-transparent hover:border-white/50'
                }`}
                style={{ background: hex, boxShadow: colorHex === hex ? `0 0 8px ${hex}cc` : undefined }}
              />
            ))}
          </div>
          <span className="w-full text-left text-[11px] font-mono text-gray-600 sm:w-auto sm:self-center sm:text-right">
            {r},{g},{b}
          </span>
        </div>
      </div>

      {/* ── Preview ── */}
      <div className="overflow-hidden rounded-2xl border border-gray-700/50 bg-gray-900/50">
        <div className="flex items-center justify-between gap-3 border-b border-gray-800/80 bg-gray-900/70 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-3 w-3 flex-shrink-0 rounded-sm border border-white/20 shadow-sm"
              style={{ background: colorHex, boxShadow: `0 0 8px ${colorHex}88` }}
            />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {showClock ? t('production.ledPreviewClockLabel') : t('production.ledPreviewLabel')}
            </span>
          </div>
          {(showClock || text) && (
            <span className="min-w-0 truncate font-mono text-[10px] text-gray-500" title={showClock ? headerClock : text}>
              {showClock ? headerClock : text}
            </span>
          )}
        </div>
        <div className="flex justify-center p-3">
          <LedPreview text={text} colorHex={colorHex} speed={scrollSpeed} showClock={showClock} />
        </div>
      </div>

      {/* ── Scroll Speed (ไม่ใช้ตอนโหมดนาฬิกา) ── */}
      {!showClock && (
      <div className="rounded-xl bg-gray-800/40 border border-gray-700/40 px-3 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-400 font-medium">{t('production.ledScrollSpeed')}</label>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <div
              onClick={() => onSpeedForAllChange(!speedForAll)}
              className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${
                speedForAll ? 'bg-indigo-500' : 'bg-gray-600'
              }`}
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                speedForAll ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </div>
            <span className="text-[11px] text-gray-400">{t('production.ledSpeedApplyAll')}</span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 w-6 text-right">{t('production.ledSpeedSlow')}</span>
          <input
            type="range"
            min={1} max={15} step={1}
            value={scrollSpeed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-indigo-500"
            style={{ accentColor: '#6366f1' }}
          />
          <span className="text-[10px] text-gray-600 w-6">{t('production.ledSpeedFast')}</span>
          <span className="text-[11px] text-indigo-400 font-mono w-14 text-right flex-shrink-0">
            {SPEED_MS[(scrollSpeed ?? 10) - 1]} ms/px
          </span>
        </div>
      </div>
      )}

      {/* ── Action buttons ── */}
      <div className="flex flex-col gap-2">
        {/* Quick text change — ไม่บันทึก Machine Log */}
        <button
          onClick={onOpenQuick}
          disabled={!hasIp || sendStatus === 'pinging'}
          className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
            !hasIp
              ? 'bg-gray-700/30 text-gray-600 cursor-not-allowed'
              : sendStatus === 'pinging'
              ? 'bg-cyan-500/30 text-cyan-400 cursor-wait'
              : sendStatus === 'ok'
              ? 'bg-green-500/20 border border-green-500/40 text-green-300'
              : sendStatus === 'error'
              ? 'bg-red-500/20 border border-red-500/40 text-red-300'
              : 'bg-cyan-500/15 border border-cyan-500/35 text-cyan-200 hover:bg-cyan-500/25 hover:border-cyan-400/55'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          เปลี่ยนข้อความด่วน
          <span className="text-[10px] font-normal opacity-60"></span>
        </button>

        {/* Full change — บันทึก Machine Log */}
        <button
          onClick={onOpenPopup}
          disabled={!hasIp || sendStatus === 'pinging'}
          className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
            !hasIp
              ? 'bg-gray-700/30 text-gray-600 cursor-not-allowed'
              : sendStatus === 'pinging'
              ? 'bg-indigo-500/30 text-indigo-400 cursor-wait'
              : sendStatus === 'ok'
              ? 'bg-green-500/20 border border-green-500/40 text-green-300'
              : sendStatus === 'error'
              ? 'bg-red-500/20 border border-red-500/40 text-red-300'
              : 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/30 hover:border-indigo-400/60'
          }`}
        >
          {sendStatus === 'pinging' ? (
            <>
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              {t('production.ledSendSending')}
            </>
          ) : sendStatus === 'ok' ? (
            t('production.ledSendOk')
          ) : sendStatus === 'error' ? (
            t('production.ledSendError')
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {t('production.ledSendBtn')}
              <span className="text-[10px] font-normal opacity-60"></span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

// ─── LedSignView ──────────────────────────────────────────────────────────────
const LedSignView = ({
  machines,
  selectedMachineId,
  allMachineStates = {},
  defaultRecorderName = '',
  canAutoPushQtyToLed = true,
  onPauseOrder,
  onResumeOrder,
  onRestoreProductionLed,
  onBack,
}) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  const validMachines = (machines ?? []).filter(Boolean);
  const sid = selectedMachineId;

  const [configs,      setConfigs]     = useState({});
  const [statuses,     setStatuses]    = useState({});
  const [pingStatuses, setPingStatuses]= useState({});
  const [pingMsgs,     setPingMsgs]   = useState({});
  const [errorMsgs,    setErrorMsgs]  = useState({});
  const [ledStates,    setLedStates]  = useState({});
  const [speedForAll,  setSpeedForAll] = useState(true);
  const [wifiStatuses, setWifiStatuses] = useState({});
  const [deviceLocalIps, setDeviceLocalIps] = useState({});
  const [heartbeatAgo, setHeartbeatAgo] = useState({});
  const [deviceRssi, setDeviceRssi] = useState({});
  const [deviceTemp, setDeviceTemp] = useState({});
  const [rebootingBoard, setRebootingBoard] = useState(false);
  const deviceLocalIpsRef = useRef(deviceLocalIps);
  useEffect(() => { deviceLocalIpsRef.current = deviceLocalIps; }, [deviceLocalIps]);

  // Popup state (full — พร้อม log สถานะเครื่องจักร)
  const [popupOpen,      setPopupOpen]      = useState(false);
  const [popupSubmitting, setPopupSubmitting] = useState(false);
  const [popupError,     setPopupError]     = useState('');

  // Quick LED popup state (เปลี่ยนข้อความอย่างเดียว ไม่ log)
  const [quickOpen,      setQuickOpen]      = useState(false);
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickError,     setQuickError]     = useState('');

  const selectedMachine = validMachines.find((m) => m.id === sid) ?? null;
  const config = configs[sid] ?? { ...DEFAULT_CONFIG };

  const setConfigField = useCallback(
    (field, value) =>
      setConfigs((prev) => {
        if (!sid) return prev;
        const next = {
          ...prev,
          [sid]: { ...(prev[sid] ?? DEFAULT_CONFIG), [field]: value },
        };
        if (field === 'scrollSpeed' && speedForAll) {
          validMachines.forEach((m) => {
            next[m.id] = { ...(next[m.id] ?? DEFAULT_CONFIG), scrollSpeed: value };
          });
        }
        return next;
      }),
    [sid, speedForAll, validMachines]
  );

  const handleSpeedForAll = useCallback((checked) => {
    setSpeedForAll(checked);
    if (checked) {
      const spd = (configs[sid] ?? DEFAULT_CONFIG).scrollSpeed ?? 10;
      setConfigs((prev) => {
        const next = { ...prev };
        validMachines.forEach((m) => {
          next[m.id] = { ...(next[m.id] ?? DEFAULT_CONFIG), scrollSpeed: spd };
        });
        return next;
      });
    }
  }, [configs, sid, validMachines]);

  const configsRef = useRef(configs);
  useEffect(() => { configsRef.current = configs; }, [configs]);
  const ledStatesRef = useRef(ledStates);
  useEffect(() => { ledStatesRef.current = ledStates; }, [ledStates]);
  const allMachineStatesRef = useRef(allMachineStates);
  useEffect(() => { allMachineStatesRef.current = allMachineStates; }, [allMachineStates]);
  const pushLedDisplayToDeviceRef = useRef(null);

  // Reset textOverride เมื่อ orderId เปลี่ยน (เริ่มงานใหม่) — ป้องกันข้อความเก่าค้าง
  const prevOrderIdRef = useRef({});
  useEffect(() => {
    if (!sid) return;
    const mState = allMachineStates[sid];
    const newOrderId = mState?.orderId ?? '';
    const prevOrderId = prevOrderIdRef.current[sid] ?? '';
    if (newOrderId && newOrderId !== prevOrderId) {
      prevOrderIdRef.current[sid] = newOrderId;
      // orderId เปลี่ยน = งานใหม่ → clear textOverride เพื่อให้ชื่อสินค้าชนะ
      setLedStates((prev) => ({
        ...prev,
        [sid]: { ...(prev[sid] ?? {}), textOverride: false },
      }));
    }
  }, [sid, allMachineStates]);

  const lastQueuedSigRef = useRef({});
  const getLiveCounterPayload = useCallback((machineId) => {
    const mState = allMachineStates[machineId];
    if (mState?.mode !== 'live') return {};
    const actual = Number(mState.pipeCounter ?? 0);
    const targetRaw = Number(mState.remainingQty ?? 0);
    const fallbackTarget = Number(mState.targetQty ?? 0);
    return {
      actual: String(actual),
      target: String(targetRaw > 0 ? targetRaw : fallbackTarget),
    };
  }, [allMachineStates]);
  const getLiveProductText = useCallback((machineId) => {
    const mState = allMachineStates[machineId];
    if (mState?.mode !== 'live') return '';
    const code = String(mState.productCode ?? '').trim();
    const name = String(mState.productName ?? '').trim();
    if (code && name) return `${code} — ${name}`;
    if (code) return code;
    if (name) return name;
    return String(mState.orderId ?? '').trim();
  }, [allMachineStates]);

  /** ส่งสิ่งที่หน้าเว็บแสดงอยู่ไปป้าย (ใช้เมื่อป้ายเพิ่งเปิด/กลับมาออนไลน์) */
  const pushLedDisplayToDevice = useCallback(async (machineId) => {
    const machine = validMachines.find((m) => m.id === machineId);
    if (!machine?.ledIp) return;

    const cfg = configsRef.current[machineId] ?? DEFAULT_CONFIG;
    const ledState = ledStatesRef.current[machineId];
    const mState = allMachineStatesRef.current[machineId];
    const isOverridden = Boolean(ledState?.textOverride);
    const isCleared = ledState?.showClock || (!String(cfg.text ?? '').trim() && !isOverridden);

    if (isCleared) {
      const payload = buildClockPayload(cfg.colorHex, cfg);
      await queueLedCommand(machineId, payload);
      lastQueuedSigRef.current = { ...lastQueuedSigRef.current, [machineId]: buildClockSignature(cfg.colorHex) };
      return;
    }

    let displayText = String(cfg.text ?? '').trim();
    let displayR = 0;
    let displayG = 255;
    let displayB = 255;

    if (!isOverridden && mState?.mode === 'live') {
      const liveTxt = getLiveProductText(machineId);
      if (liveTxt) {
        displayText = liveTxt;
        displayR = 0;
        displayG = 255;
        displayB = 0;
      }
    } else {
      const { r, g, b } = hexToRgb(cfg.colorHex ?? '#00ffff');
      displayR = r;
      displayG = g;
      displayB = b;
    }

    if (!displayText) return;

    const speedMs = SPEED_MS[(cfg.scrollSpeed ?? 10) - 1] ?? 50;
    const sig = `${displayText}|${displayR},${displayG},${displayB}|${cfg.fontSize ?? 1}|${speedMs}`;
    if (lastQueuedSigRef.current[machineId] === sig) return;

    await queueLedCommand(machineId, {
      text: displayText,
      r: displayR,
      g: displayG,
      b: displayB,
      fontSize: cfg.fontSize ?? 1,
      speed: speedMs,
      textOverride: isOverridden,
      ...getLiveCounterPayload(machineId),
    });
    lastQueuedSigRef.current = { ...lastQueuedSigRef.current, [machineId]: sig };
  }, [validMachines, getLiveCounterPayload, getLiveProductText]);
  useEffect(() => {
    pushLedDisplayToDeviceRef.current = pushLedDisplayToDevice;
  }, [pushLedDisplayToDevice]);

  const mergeLedStatusIntoUi = useCallback((machineId, res) => {
    const state = res?.state ?? null;
    const isCleared = state?.showClock || (res?.hasState && !String(state?.text ?? '').trim());
    const has = res?.hasState && state && !isCleared && String(state.text ?? '').trim().length > 0;
    setLedStates((prev) => ({ ...prev, [machineId]: state }));
    if (isCleared) {
      setConfigs((prev) => ({
        ...prev,
        [machineId]: {
          ...(prev[machineId] ?? DEFAULT_CONFIG),
          text: '',
          colorHex: rgbToHex(state?.r ?? 0, state?.g ?? 255, state?.b ?? 0),
        },
      }));
      lastQueuedSigRef.current = {
        ...lastQueuedSigRef.current,
        [machineId]: buildClockSignature(rgbToHex(state?.r ?? 0, state?.g ?? 255, state?.b ?? 0)),
      };
    } else if (has) {
      const scrollIdx = speedMsToScrollIndex(state.speed);
      setConfigs((prev) => ({
        ...prev,
        [machineId]: {
          text: String(state.text ?? ''),
          colorHex: rgbToHex(state.r ?? 0, state.g ?? 255, state.b ?? 255),
          fontSize: state.fontSize ?? 1,
          scrollSpeed: scrollIdx,
        },
      }));
      lastQueuedSigRef.current = {
        ...lastQueuedSigRef.current,
        [machineId]: serverStateToSignature(state),
      };
    } else {
      lastQueuedSigRef.current = { ...lastQueuedSigRef.current, [machineId]: '' };
    }
  }, []);

  const handleSpeedChange = useCallback((value) => {
    setConfigField('scrollSpeed', value);
  }, [setConfigField]);

  // Load LED state from server on machine change
  useEffect(() => {
    if (!sid) return;
    getLedStatus(sid)
      .then((res) => mergeLedStatusIntoUi(sid, res))
      .catch(() => {
        setLedStates((prev) => ({ ...prev, [sid]: null }));
        lastQueuedSigRef.current = { ...lastQueuedSigRef.current, [sid]: '' };
      });
  }, [sid, mergeLedStatusIntoUi]);

  // ── SSE: receive LED state changes pushed by other browsers instantly ────
  // When any browser calls queueLedCommand(), backend broadcasts led_state / led_updated
  // → all connected LedSignView instances receive it in <300ms
  const handleSseLedState = useCallback(({ machineId, state }) => {
    if (!machineId || !state) return;
    mergeLedStatusIntoUi(machineId, { hasState: true, state });
  }, [mergeLedStatusIntoUi]);

  // led_updated carries { machineId, ledConfig } where ledConfig = { text, r, g, b, fontSize, speed }
  const handleSseLedUpdated = useCallback(({ machineId, ledConfig, state }) => {
    if (!machineId) return;
    // Normalise: accept either ledConfig or state shape
    const normalised = ledConfig ?? state;
    if (normalised) {
      mergeLedStatusIntoUi(machineId, { hasState: true, state: normalised });
    }
  }, [mergeLedStatusIntoUi]);

  // LED SSE มาจาก index.jsx ตัวเดียว — ฟังผ่าน window event (ไม่เปิด EventSource ซ้ำ)
  useEffect(() => {
    const onLedState = (e) => handleSseLedState(e.detail ?? {});
    const onLedUpdated = (e) => handleSseLedUpdated(e.detail ?? {});
    window.addEventListener('sse:led_state', onLedState);
    window.addEventListener('sse:led_updated', onLedUpdated);
    return () => {
      window.removeEventListener('sse:led_state', onLedState);
      window.removeEventListener('sse:led_updated', onLedUpdated);
    };
  }, [handleSseLedState, handleSseLedUpdated]);

  // ── SSE: re-push LED when production qty changes for the active machine ──
  // Listens to sse:production_updated from index.jsx (window event)
  const prevProductionQtyRef = useRef({});
  useEffect(() => {
    const handler = (e) => {
      if (!canAutoPushQtyToLed) return;
      const { machineId: mid, qty_good, qty_remaining } = e.detail ?? {};
      if (!mid) return;

      const prevGood = prevProductionQtyRef.current[mid]?.qty_good;
      const prevRem  = prevProductionQtyRef.current[mid]?.qty_remaining;

      const goodChanged = typeof qty_good === 'number' && qty_good !== prevGood;
      const remChanged  = typeof qty_remaining === 'number' && qty_remaining !== prevRem;

      prevProductionQtyRef.current[mid] = { qty_good, qty_remaining };

      if (!goodChanged && !remChanged) return;

      // Only re-push LED for the currently selected machine
      if (mid !== sid) return;
      const machine = validMachines.find((m) => m.id === mid);
      if (!machine?.ledIp) return;

      // Build updated LED command with new counters
      const cfg = configsRef.current[mid] ?? DEFAULT_CONFIG;
      const isOverridden = Boolean(ledStatesRef.current[mid]?.textOverride);
      const mState = allMachineStatesRef.current[mid];

      // ถ้าไม่ได้ override → ใช้ชื่อสินค้าจริงๆ (green) แทน cfg.text เก่า
      let displayText = cfg.text;
      let displayR = 0, displayG = 255, displayB = 0;
      if (!isOverridden && mState?.mode === 'live') {
        const code = String(mState.productCode ?? '').trim();
        const name = String(mState.productName ?? '').trim();
        const liveTxt = code && name ? `${code} — ${name}` : (code || name || String(mState.orderId ?? '').trim());
        if (liveTxt) {
          displayText = liveTxt;
        } else {
          displayR = 0; displayG = 255; displayB = 0;
        }
      } else if (isOverridden) {
        const { r, g, b } = hexToRgb(cfg.colorHex ?? '#00ffff');
        displayR = r; displayG = g; displayB = b;
      }

      if (!displayText) return;
      const speedMs = SPEED_MS[(cfg.scrollSpeed ?? 10) - 1] ?? 50;
      queueLedCommand(mid, {
        text: displayText,
        r: displayR, g: displayG, b: displayB,
        fontSize: cfg.fontSize ?? 1,
        speed: speedMs,
        textOverride: isOverridden,
        actual: String(qty_good ?? 0),
        target: String(qty_remaining ?? 0),
      }).catch(() => { /* retry handled by next poll */ });
    };

    window.addEventListener('sse:production_updated', handler);
    return () => window.removeEventListener('sse:production_updated', handler);
  }, [sid, validMachines, canAutoPushQtyToLed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fallback poll every 10s (was 3s) — SSE is now primary ────────────────
  const ledPollRef = useRef(null);
  useEffect(() => {
    if (ledPollRef.current) clearInterval(ledPollRef.current);
    if (!sid) return;

    ledPollRef.current = setInterval(() => {
      getLedStatus(sid)
        .then((res) => mergeLedStatusIntoUi(sid, res))
        .catch(() => {});
    }, 10_000); // 10s fallback (SSE delivers in <300ms)

    return () => {
      if (ledPollRef.current) clearInterval(ledPollRef.current);
      ledPollRef.current = null;
    };
  }, [sid, mergeLedStatusIntoUi]);

  // Auto-push debounce for color/speed changes (not text — text goes through popup)
  const autoPushDebounceRef = useRef(null);
  useEffect(() => {
    if (autoPushDebounceRef.current) clearTimeout(autoPushDebounceRef.current);
    if (!sid || !selectedMachine?.id) return;

    autoPushDebounceRef.current = setTimeout(async () => {
      const targets = speedForAll
        ? validMachines.filter((m) => m.ledIp)
        : selectedMachine?.ledIp ? [selectedMachine] : [];

      for (const machine of targets) {
        const cfg = configsRef.current[machine.id] ?? DEFAULT_CONFIG;
        const ledState = ledStatesRef.current[machine.id];
        const { r, g, b } = hexToRgb(cfg.colorHex ?? '#00ffff');
        const speedMs = SPEED_MS[(cfg.scrollSpeed ?? 10) - 1] ?? 50;

        if (ledState?.showClock) {
          const sig = buildClockSignature(cfg.colorHex);
          if (lastQueuedSigRef.current[machine.id] === sig) continue;
          try {
            await queueLedCommand(machine.id, buildClockPayload(cfg.colorHex, cfg));
            lastQueuedSigRef.current = { ...lastQueuedSigRef.current, [machine.id]: sig };
          } catch {
            /* retry next cycle */
          }
          continue;
        }

        const sig = buildLedConfigSignature(cfg);
        if (!sig) continue;
        if (lastQueuedSigRef.current[machine.id] === sig) continue;

        try {
          const liveCounterPayload = getLiveCounterPayload(machine.id);
          await queueLedCommand(machine.id, {
            text: cfg.text,
            r, g, b,
            fontSize: cfg.fontSize ?? 1,
            speed: speedMs,
            textOverride: Boolean(ledState?.textOverride),
            ...liveCounterPayload,
          });
          lastQueuedSigRef.current = { ...lastQueuedSigRef.current, [machine.id]: sig };
        } catch {
          /* retry next cycle */
        }
      }
    }, 1200);

    return () => {
      if (autoPushDebounceRef.current) clearTimeout(autoPushDebounceRef.current);
    };
  }, [configs, sid, selectedMachine, speedForAll, validMachines, getLiveCounterPayload, ledStates]);

  // Auto-ping every 15s
  const pingIntervalRef = useRef(null);
  const prevWifiOnlineRef = useRef({});
  const wifiFailStreakRef = useRef({});
  const heartbeatInFlightRef = useRef({});

  useEffect(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    if (!sid) {
      return;
    }

    const applyHeartbeat = (result) => {
      const localIp = result?.deviceLocalIp?.trim() || null;
      const wasOnline = prevWifiOnlineRef.current[sid] === true;
      const isOnline = Boolean(result?.online);

      setDeviceLocalIps((prev) => ({ ...prev, [sid]: localIp }));
      setHeartbeatAgo((prev) => ({
        ...prev,
        [sid]: result?.secondsAgo != null ? result.secondsAgo : null,
      }));
      setDeviceRssi((prev) => ({
        ...prev,
        [sid]: result?.rssi != null ? result.rssi : null,
      }));
      setDeviceTemp((prev) => ({
        ...prev,
        [sid]: result?.temp != null ? result.temp : null,
      }));
      if (isOnline) {
        wifiFailStreakRef.current[sid] = 0;
        setWifiStatuses((prev) => ({ ...prev, [sid]: 'online' }));
        setPingMsgs((prev) => ({ ...prev, [sid]: '' }));
        if (!wasOnline) {
          pushLedDisplayToDeviceRef.current?.(sid).catch(() => {});
        }
      } else {
        const failStreak = (wifiFailStreakRef.current[sid] ?? 0) + 1;
        wifiFailStreakRef.current[sid] = failStreak;
        if (wasOnline && failStreak < WIFI_FAILS_BEFORE_OFFLINE) {
          setPingMsgs((prev) => ({ ...prev, [sid]: 'Heartbeat แกว่ง — กำลังตรวจสอบ…' }));
          return;
        }
        setWifiStatuses((prev) => ({ ...prev, [sid]: 'offline' }));
        const ago = result?.secondsAgo != null ? ` (${result.secondsAgo}s ago)` : '';
        setPingMsgs((prev) => ({ ...prev, [sid]: `Offline${ago}` }));
      }
      prevWifiOnlineRef.current[sid] = isOnline;
    };

    const doPing = (showChecking = false) => {
      if (heartbeatInFlightRef.current[sid]) return;
      heartbeatInFlightRef.current[sid] = true;
      if (showChecking) {
        setWifiStatuses((prev) => ({ ...prev, [sid]: 'checking' }));
      }
      getLedHeartbeat(sid)
        .then(applyHeartbeat)
        .catch(() => {
          const wasOnline = prevWifiOnlineRef.current[sid] === true;
          const failStreak = (wifiFailStreakRef.current[sid] ?? 0) + 1;
          wifiFailStreakRef.current[sid] = failStreak;
          if (wasOnline && failStreak < WIFI_FAILS_BEFORE_OFFLINE) {
            setPingMsgs((prev) => ({ ...prev, [sid]: 'สัญญาณขาดช่วงสั้นๆ — กำลังตรวจสอบ…' }));
            return;
          }
          prevWifiOnlineRef.current[sid] = false;
          setWifiStatuses((prev) => ({ ...prev, [sid]: 'offline' }));
          setPingMsgs((prev) => ({ ...prev, [sid]: '' }));
        })
        .finally(() => {
          heartbeatInFlightRef.current[sid] = false;
        });
    };

    doPing(true);
    pingIntervalRef.current = setInterval(() => doPing(false), 5000);

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };
  }, [sid]);

  // ── Popup handlers ────────────────────────────────────────────────────────
  const handleOpenPopup = useCallback(() => {
    setPopupError('');
    setPopupOpen(true);
  }, []);

  const handleConfirmPopup = useCallback(async (formData) => {
    if (!selectedMachine?.id || !sid) return;

    setPopupSubmitting(true);
    setPopupError('');

    try {
      // Pause running order if live
      const mState = allMachineStates[sid];
      if (mState?.mode === 'live' && onPauseOrder) {
        onPauseOrder(sid);
      }

      // Build LED command params
      const { r, g, b } = hexToRgb(formData.colorHex ?? config.colorHex ?? '#ff0000');
      const speedMs = SPEED_MS[(config.scrollSpeed ?? 10) - 1] ?? 50;
      const ledPayload = {
        text: formData.ledText,
        r, g, b,
        fontSize: config.fontSize ?? 1,
        speed: speedMs,
      };

      // Send LED command
      await queueLedCommand(selectedMachine.id, ledPayload);

      // Update local config
      const newColorHex = formData.colorHex ?? config.colorHex;
      const newCfg = {
        ...(configs[sid] ?? DEFAULT_CONFIG),
        text: formData.ledText,
        colorHex: newColorHex,
      };
      setConfigs(prev => ({ ...prev, [sid]: newCfg }));
      lastQueuedSigRef.current = {
        ...lastQueuedSigRef.current,
        [sid]: buildLedConfigSignature(newCfg),
      };
      setStatuses(prev => ({ ...prev, [sid]: 'ok' }));
      setLedStates(prev => ({
        ...prev,
        [sid]: { text: formData.ledText, r, g, b, fontSize: 1, updatedAt: new Date().toISOString() },
      }));
      setTimeout(() => setStatuses(prev => ({ ...prev, [sid]: 'idle' })), 4000);

      // Log to Machine Log sheet (fire-and-forget, don't block popup close)
      appendMachineLog({
        machine:     formData.machine,
        date:        formData.date,
        status:      formData.status,
        time:        formData.time,
        cause:       formData.cause,
        team:        formData.team,
        reporter:    formData.reporter,
        productCode: formData.productCode,
        detail:      formData.detail,
        fix:         formData.fix,
      }).catch(() => {});

      setPopupOpen(false);
    } catch (err) {
      setPopupError(err?.message ?? 'เกิดข้อผิดพลาด — ลองใหม่อีกครั้ง');
      setStatuses(prev => ({ ...prev, [sid]: 'error' }));
    } finally {
      setPopupSubmitting(false);
    }
  }, [sid, selectedMachine, configs, config, allMachineStates, onPauseOrder]);

  // ── Quick LED handler (ไม่ log สถานะเครื่องจักร) ──────────────────────────
  const handleQuickLed = useCallback(async ({ text, showSuffix = true }) => {
    if (!selectedMachine?.id || !sid) return;
    setQuickSubmitting(true);
    setQuickError('');
    try {
      const cfg = configs[sid] ?? DEFAULT_CONFIG;
      const { r, g, b } = hexToRgb(cfg.colorHex ?? '#00ffff');
      const speedMs = SPEED_MS[(cfg.scrollSpeed ?? 10) - 1] ?? 50;

      const now = new Date();
      const nameSuffix = showSuffix && defaultRecorderName
        ? ` |- ${defaultRecorderName} ${formatDateThaiShort(now)} - ${formatTimeThaiDot(now)}`
        : '';
      const fullText = text + nameSuffix;
      const liveCounterPayload = getLiveCounterPayload(sid);

      await queueLedCommand(selectedMachine.id, {
        text: fullText,
        r, g, b,
        fontSize: cfg.fontSize ?? 1,
        speed: speedMs,
        textOverride: true,
        ...liveCounterPayload,
      });

      // อัปเดต local config และ signature (ใช้ fullText ที่ต่อท้ายชื่อ/วันที่/เวลาแล้ว)
      const newCfg = { ...cfg, text: fullText };
      setConfigs(prev => ({ ...prev, [sid]: newCfg }));
      lastQueuedSigRef.current = { ...lastQueuedSigRef.current, [sid]: buildLedConfigSignature(newCfg) };
      setStatuses(prev => ({ ...prev, [sid]: 'ok' }));
      setLedStates(prev => ({ ...prev, [sid]: { text: fullText, r, g, b, fontSize: cfg.fontSize ?? 1, textOverride: true, updatedAt: new Date().toISOString() } }));
      setTimeout(() => setStatuses(prev => ({ ...prev, [sid]: 'idle' })), 4000);
      setQuickOpen(false);
    } catch (err) {
      setQuickError(err?.message ?? 'เกิดข้อผิดพลาด — ลองใหม่อีกครั้ง');
    } finally {
      setQuickSubmitting(false);
    }
  }, [sid, selectedMachine, configs, getLiveCounterPayload, defaultRecorderName]);

  const handleRebootBoard = useCallback(async () => {
    if (!sid || rebootingBoard) return;

    const localIp = deviceLocalIpsRef.current[sid]?.trim() || '';
    const sheetIp = selectedMachine?.ledIp?.trim() || '';
    const ips = collectRebootIps(localIp, sheetIp);
    if (ips.length === 0) {
      setPingMsgs((prev) => ({
        ...prev,
        [sid]: t('production.ledRebootNoIp'),
      }));
      return;
    }

    const wasOffline = wifiStatuses[sid] === 'offline' || prevWifiOnlineRef.current[sid] !== true;

    setRebootingBoard(true);
    setPingMsgs((prev) => ({
      ...prev,
      [sid]: wasOffline ? t('production.ledRebootSendingOffline') : t('production.ledRebootSending'),
    }));

    try {
      await rebootLedMulti(ips.join(','));

      prevWifiOnlineRef.current[sid] = false;
      wifiFailStreakRef.current[sid] = 0;
      setPingMsgs((prev) => ({ ...prev, [sid]: t('production.ledRebootSent') }));
      await new Promise((resolve) => setTimeout(resolve, 6000));

      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          const hb = await getLedHeartbeat(sid);
          const hbIp = hb.deviceLocalIp?.trim() || localIp || ips[0] || null;
          setDeviceLocalIps((prev) => ({ ...prev, [sid]: hbIp }));
          setHeartbeatAgo((prev) => ({
            ...prev,
            [sid]: hb.secondsAgo != null ? hb.secondsAgo : null,
          }));
          setDeviceRssi((prev) => ({
            ...prev,
            [sid]: hb.rssi != null ? hb.rssi : null,
          }));
          setDeviceTemp((prev) => ({
            ...prev,
            [sid]: hb.temp != null ? hb.temp : null,
          }));

          if (hb.online) {
            setWifiStatuses((prev) => ({ ...prev, [sid]: 'online' }));
            setPingMsgs((prev) => ({ ...prev, [sid]: t('production.ledRebootOk') }));
            prevWifiOnlineRef.current[sid] = true;
            pushLedDisplayToDeviceRef.current?.(sid).catch(() => {});
            return;
          }
        } catch {
          /* retry */
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      setWifiStatuses((prev) => ({ ...prev, [sid]: 'offline' }));
      setPingMsgs((prev) => ({ ...prev, [sid]: t('production.ledRebootWaitTimeout') }));
    } catch (err) {
      setWifiStatuses((prev) => ({ ...prev, [sid]: 'offline' }));
      setPingMsgs((prev) => ({
        ...prev,
        [sid]: err?.message ?? t('production.ledRebootFailed'),
      }));
    } finally {
      setRebootingBoard(false);
    }
  }, [sid, selectedMachine, rebootingBoard, wifiStatuses, t]);

  const [clearStatus, setClearStatus] = useState('idle');

  const handleClearLed = useCallback(async () => {
    if (!selectedMachine?.id || !sid) return;
    const cfg = configs[sid] ?? DEFAULT_CONFIG;
    const payload = buildClockPayload(cfg.colorHex, cfg);
    setClearStatus('clearing');
    try {
      await queueLedCommand(selectedMachine.id, payload);
      const cleared = { ...payload, updatedAt: new Date().toISOString() };
      setLedStates((prev) => ({ ...prev, [sid]: cleared }));
      setConfigs((prev) => ({
        ...prev,
        [sid]: { ...(prev[sid] ?? DEFAULT_CONFIG), text: '' },
      }));
      lastQueuedSigRef.current = { ...lastQueuedSigRef.current, [sid]: buildClockSignature(cfg.colorHex) };
      setClearStatus('ok');
    } catch {
      setClearStatus('error');
    }
    setTimeout(() => setClearStatus('idle'), 4000);
  }, [sid, selectedMachine, configs]);

  // Force sync
  const [syncStatus, setSyncStatus] = useState('idle');
  const handleForceSync = useCallback(async () => {
    if (!selectedMachine?.id || !sid) return;
    const cfg = configs[sid] ?? DEFAULT_CONFIG;
    if (!cfg.text) return;
    const { r, g, b } = hexToRgb(cfg.colorHex);
    setSyncStatus('syncing');
    try {
      const speedMs = SPEED_MS[(cfg.scrollSpeed ?? 10) - 1] ?? 50;
      const liveCounterPayload = getLiveCounterPayload(sid);
      await queueLedCommand(selectedMachine.id, {
        text: cfg.text,
        r, g, b,
        fontSize: cfg.fontSize,
        speed: speedMs,
        textOverride: Boolean(ledStates[sid]?.textOverride),
        ...liveCounterPayload,
      });
      lastQueuedSigRef.current = {
        ...lastQueuedSigRef.current,
        [selectedMachine.id]: buildLedConfigSignature(cfg),
      };
      setSyncStatus('ok');
    } catch {
      setSyncStatus('error');
    }
    setTimeout(() => setSyncStatus('idle'), 3000);
  }, [sid, selectedMachine, configs, getLiveCounterPayload, ledStates]);

  const handleRestoreLiveProductText = useCallback(async () => {
    if (!selectedMachine?.id || !sid) return;
    const liveText = getLiveProductText(sid);
    if (!liveText) return;
    const cfg = configs[sid] ?? DEFAULT_CONFIG;
    const speedMs = SPEED_MS[(cfg.scrollSpeed ?? 10) - 1] ?? 50;
    // บังคับสีเขียวเสมอตอน restore ป้ายจากการรันงาน
    const GREEN_HEX = '#00ff00';
    const { r, g, b } = hexToRgb(GREEN_HEX);
    try {
      if (onRestoreProductionLed) {
        await Promise.resolve(onRestoreProductionLed(sid));
      } else {
        await queueLedCommand(selectedMachine.id, {
          text: liveText,
          r, g, b,
          fontSize: cfg.fontSize ?? 1,
          speed: speedMs,
          textOverride: false,
          ...getLiveCounterPayload(sid),
        });
      }
      setLedStates((prev) => ({
        ...prev,
        [sid]: {
          ...(prev[sid] ?? {}),
          text: liveText,
          r, g, b,
          textOverride: false,
          updatedAt: new Date().toISOString(),
        },
      }));
      setConfigs((prev) => ({
        ...prev,
        [sid]: { ...(prev[sid] ?? DEFAULT_CONFIG), text: liveText, colorHex: GREEN_HEX },
      }));
      setStatuses((prev) => ({ ...prev, [sid]: 'ok' }));
      setTimeout(() => setStatuses((prev) => ({ ...prev, [sid]: 'idle' })), 4000);
    } catch {
      setStatuses((prev) => ({ ...prev, [sid]: 'error' }));
    }
  }, [sid, selectedMachine, configs, onRestoreProductionLed, getLiveCounterPayload, getLiveProductText]);

  const activeMachineState = sid ? allMachineStates[sid] : null;
  const liveProductText = sid ? getLiveProductText(sid) : '';
  const isLiveMachine = activeMachineState?.mode === 'live';
  const isTextOverridden = Boolean(ledStates[sid]?.textOverride);
  const currentLedText = String(configs[sid]?.text ?? '').trim();
  const shouldShowRestoreProductBtn = Boolean(
    sid
    && isLiveMachine
    && liveProductText
    && (isTextOverridden || currentLedText !== liveProductText)
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-900/20">
      <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-gray-800 px-3 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white">{t('production.ledTitle')}</h2>
            <p className="text-xs text-gray-500 truncate">
              {selectedMachine ? `${selectedMachine.label} · ${t('production.ledSubtitleSelected')}` : t('production.ledSubtitleNoMachine')}
            </p>
          </div>
        </div>
        {onBack && (
          <ProductionViewExitButton onClick={onBack} size="sm" className="shrink-0" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 max-w-3xl mx-auto w-full">
        {/* ── Resume banner ── */}
        {(() => {
          const mState = allMachineStates[sid];
          const paused = mState?.pausedOrder;
          if (!paused || !sid) return null;
          return (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/8 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4">
              <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-yellow-300">
                  Order <span className="font-mono">{paused.orderId}</span> {t('production.ledPausedAutoBanner')}
                </p>
                <p className="text-[11px] text-yellow-500/60 mt-0.5">
                  {paused.pipeCounter} / {paused.remainingQty > 0 ? paused.remainingQty : paused.targetQty} {t('production.ledPausedPcs')}
                  {paused.employeeId && <span className="ml-1.5">· {paused.employeeId}{paused.shift ? ` ${t('production.ledPausedShift')} ${paused.shift}` : ''}</span>}
                </p>
              </div>
              {onResumeOrder && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await Promise.resolve(onResumeOrder(sid));
                      const res = await getLedStatus(sid);
                      mergeLedStatusIntoUi(sid, res);
                    } catch {
                      /* non-critical */
                    }
                  }}
                  className="flex min-h-[44px] w-full flex-shrink-0 items-center justify-center gap-1.5 rounded-lg border border-yellow-500/40 bg-yellow-500/15 px-3 py-2 text-xs font-semibold text-yellow-300 transition-all hover:bg-yellow-500/25 sm:w-auto"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {t('production.ledResumeBtn')}
                </button>
              )}
            </div>
          );
        })()}

        {selectedMachine ? (
          <>
            {shouldShowRestoreProductBtn && (
              <button
                type="button"
                onClick={handleRestoreLiveProductText}
                className="mb-3 w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 transition-all hover:bg-emerald-500/20"
              >
                {t('production.ledRestoreProductBtn')}
              </button>
            )}
            <ControlPanel
              machine={selectedMachine}
              config={config}
              onChange={setConfigField}
              onSpeedChange={handleSpeedChange}
              onOpenPopup={handleOpenPopup}
              onOpenQuick={() => { setQuickError(''); setQuickOpen(true); }}
              onClearLed={handleClearLed}
              clearStatus={clearStatus}
              onReboot={handleRebootBoard}
              rebooting={rebootingBoard}
              onForceSync={handleForceSync}
              sendStatus={statuses[sid]      ?? 'idle'}
              pingStatus={pingStatuses[sid]  ?? 'idle'}
              pingMsg={pingMsgs[sid]         ?? ''}
              errorMsg={errorMsgs[sid]       ?? ''}
              wifiStatus={wifiStatuses[sid] ?? 'checking'}
              deviceLocalIp={deviceLocalIps[sid] ?? null}
              heartbeatSecondsAgo={heartbeatAgo[sid] ?? null}
              deviceRssi={deviceRssi[sid] ?? null}
              deviceTemp={deviceTemp[sid] ?? null}
              syncStatus={syncStatus}
              speedForAll={speedForAll}
              onSpeedForAllChange={handleSpeedForAll}
              showClock={Boolean(ledStates[sid]?.showClock)}
            />
          </>
        ) : (
          <div className="h-full min-h-[320px] flex items-center justify-center text-gray-500 text-sm">
            {t('production.ledNoMachineHint')}
          </div>
        )}
      </div>

      {/* <div className="flex-shrink-0 px-4 sm:px-6 py-3 border-t border-gray-800 bg-gray-900/50">
        <p className="text-[11px] text-gray-600">
          <span className="text-yellow-500/70">⚠</span>{' '}
          {t('production.ledFooterHint')}
        </p>
      </div> */}

      {/* ── LED Form Popup (บันทึก Machine Log) ── */}
      <LedFormPopup
        isOpen={popupOpen}
        onClose={() => { if (!popupSubmitting) setPopupOpen(false); }}
        onConfirm={handleConfirmPopup}
        machine={selectedMachine}
        mState={allMachineStates[sid] ?? null}
        submitting={popupSubmitting}
        confirmError={popupError}
        defaultRecorderName={defaultRecorderName}
      />

      {/* ── Quick LED Popup (ไม่บันทึก Machine Log) ── */}
      <QuickLedPopup
        isOpen={quickOpen}
        onClose={() => { if (!quickSubmitting) setQuickOpen(false); }}
        onConfirm={handleQuickLed}
        machine={selectedMachine}
        currentConfig={configs[sid] ?? DEFAULT_CONFIG}
        submitting={quickSubmitting}
        confirmError={quickError}
        recorderName={defaultRecorderName}
      />
    </div>
  );
};

export default LedSignView;
