/** รายการแผนกแนะนำ + ที่ผู้ใช้เคยกรอก (localStorage) */
const STORAGE_KEY = 'maintenance_department_suggestions_v2';

const DEFAULT_DEPARTMENTS = [
    'PEP (แผนกวิศวกรรมการผลิต)',
    'PEV (แผนกวิศวกรรมยานพาหนะ)',
    'R&D (แผนกวิจัยและพัฒนา)',
    'SWH (แผนกคลังสินค้า)',
    'DLV (แผนกจัดส่ง)',
    'ห้องโม่ (ห้องโม่)',
    'MTN (แผนกซ่อมบำรุง)',
    'HRS (แผนกทรัพยากรบุคคล)',
    'PUR (แผนกจัดซื้อ)',
    'QUA (แผนกประกันคุณภาพ / ควบคุมคุณภาพ)',
    'DCC (แผนกควบคุมเอกสาร)',
    'ICT (แผนกเทคโนโลยีสารสนเทศและการสื่อสาร)',
    'MKT (แผนกการตลาด)',
    'SK-PEV (แผนกสโตร์/คลังสินค้า (ยานพาหนะ))',
    'I N-REC (แผนกรับสินค้าขาเข้า)',
];

export function getDepartmentSuggestions() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [...DEFAULT_DEPARTMENTS];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [...DEFAULT_DEPARTMENTS];
        const merged = [...new Set([...DEFAULT_DEPARTMENTS, ...parsed.map(String)])];
        return merged.sort((a, b) => a.localeCompare(b, 'th'));
    } catch {
        return [...DEFAULT_DEPARTMENTS];
    }
}

export function rememberDepartment(name) {
    const t = String(name || '').trim();
    if (!t) return;
    const set = new Set(getDepartmentSuggestions());
    set.add(t);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set].sort((a, b) => a.localeCompare(b, 'th'))));
}

export function toDatetimeLocalValue(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** โครงสร้าง payload ใบแจ้งซ่อม FR-MTN-04 (JSON ใน database) */
export function createDefaultMaintenancePayload() {
    return {
        notifiedAt: toDatetimeLocalValue(),
        requesterName: '',
        department: '',
        /** @deprecated รวมกับ requesterName + department — ใช้ตอน normalize ข้อมูลเก่า */
        requesterDepartment: '',
        machineEquipment: '',
        workType: {
            bm: false,
            cm: false,
            pm: false,
            other: false,
            otherDetail: '',
        },
        symptoms: '',
        urgency: 'normal',
        remarks: '',
        signatures: {
            reporter: '',
        },
        maintenance: {
            type: { machine: false, support: false, general: false },
            receiver: '',
            departmentHead: '',
            expectedCompletion: '',
            problematicSystem: {
                electric: false,
                hydraulic: false,
                pneumatic: false,
                mechanic: false,
                water: false,
                other: false,
                otherDetail: '',
            },
            performedBy: { internal: false, external: false, vendor: false },
            actionTaken: '',
        },
        analysis: {
            cause: '',
            prevention: '',
            usageInstructions: '',
        },
        procurement: {
            orderDate: '',
            prNo: '',
            receivedDate: '',
        },
        timeline: {
            startDate: '',
            completionDate: '',
            totalMinutes: '',
            costBaht: '',
            actualRepairMinutes: '',
            performedByName: '',
            performedDate: '',
        },
        inspection: {
            result: '',
            inspectorName: '',
            inspectorDate: '',
            productionPlanningName: '',
            productionPlanningDate: '',
        },
    };
}

export function normalizePayload(raw) {
    const base = createDefaultMaintenancePayload();
    if (!raw || typeof raw !== 'object') return base;

    let requesterName = raw.requesterName ?? '';
    let department = raw.department ?? '';
    if (!requesterName && !department && raw.requesterDepartment) {
        const combined = String(raw.requesterDepartment).trim();
        const parts = combined.split(/\s*\/\s*/);
        if (parts.length >= 2) {
            requesterName = parts[0].trim();
            department = parts.slice(1).join(' / ').trim();
        } else {
            requesterName = combined;
        }
    }

    const sig = { ...base.signatures, ...(raw.signatures || {}) };

    return {
        ...base,
        ...raw,
        notifiedAt: raw.notifiedAt ?? base.notifiedAt,
        requesterName,
        department,
        workType: { ...base.workType, ...(raw.workType || {}) },
        signatures: {
            reporter: sig.reporter ?? '',
        },
        maintenance: {
            ...base.maintenance,
            ...(raw.maintenance || {}),
            type: { ...base.maintenance.type, ...(raw.maintenance?.type || {}) },
            problematicSystem: {
                ...base.maintenance.problematicSystem,
                ...(raw.maintenance?.problematicSystem || {}),
            },
            performedBy: { ...base.maintenance.performedBy, ...(raw.maintenance?.performedBy || {}) },
        },
        analysis: { ...base.analysis, ...(raw.analysis || {}) },
        procurement: { ...base.procurement, ...(raw.procurement || {}) },
        timeline: { ...base.timeline, ...(raw.timeline || {}) },
        inspection: { ...base.inspection, ...(raw.inspection || {}) },
    };
}
