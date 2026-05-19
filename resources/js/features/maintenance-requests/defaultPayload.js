import { toDatetimeLocalValue } from './departmentStorage';

export { toDatetimeLocalValue } from './departmentStorage';

/** ค่าเริ่มต้นคงที่ (ไม่รวมวันเวลาปัจจุบัน) — ใช้ใน normalize เพื่อไม่ให้ notifiedAt เด้งทุกครั้งที่พิมพ์ */
function maintenancePayloadShape() {
    return {
        notifiedAt: '',
        requesterName: '',
        department: '',
        /** @deprecated */
        requesterDepartment: '',
        /** ประเภทงานคอลัมน์ F ใน Sheet ทะเบียน */
        registerWorkCategory: '',
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
            abnormalReason: '',
            inspectorName: '',
            inspectorDate: '',
            productionPlanningName: '',
            productionPlanningDate: '',
        },
    };
}

/** เปิดฟอร์มใหม่ — วันที่/เวลาแจ้ง = ปัจจุบัน */
export function createDefaultMaintenancePayload() {
    return {
        ...maintenancePayloadShape(),
        notifiedAt: toDatetimeLocalValue(),
    };
}

export function normalizePayload(raw) {
    const base = maintenancePayloadShape();
    if (!raw || typeof raw !== 'object') {
        return { ...base };
    }

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
        registerWorkCategory:
            raw.registerWorkCategory !== undefined && raw.registerWorkCategory !== null
                ? String(raw.registerWorkCategory)
                : (base.registerWorkCategory ?? ''),
        notifiedAt: raw.notifiedAt != null && String(raw.notifiedAt).length > 0 ? raw.notifiedAt : base.notifiedAt,
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
