/** รายการเครื่องจักรแนะนำ + ที่ผู้ใช้เคยพิมพ์เพิ่ม (localStorage) */
const STORAGE_KEY = 'maintenance_machine_equipment_suggestions';

const DEFAULT_MACHINES = [
    'EM 08',
    'EM 9A',
    'EM 9B',
    'EM 10',
    'EM 16',
    'EM 17',
    'EM 18',
    'EM 20',
    'EM 21',
    'EM 22',
    'EM 23',
    'EM 24',
    'EM 25',
    'EM 26',
    'EM 27',
    'EM 06',
    'EM 12',
    'EM 13',
    'EM 15',
    'EM 03',
    'EM 04',
    'EM 07',
];

export function getMachineEquipmentSuggestions() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [...DEFAULT_MACHINES];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [...DEFAULT_MACHINES];
        const merged = [...new Set([...DEFAULT_MACHINES, ...parsed.map(String)])];
        return merged.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    } catch {
        return [...DEFAULT_MACHINES];
    }
}

export function rememberMachineEquipment(name) {
    const t = String(name || '').trim();
    if (!t) return;
    const set = new Set(getMachineEquipmentSuggestions());
    set.add(t);
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...set].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })))
    );
}
