/** โครงสร้าง payload ใบแจ้งซ่อม FR-MTN-04 (JSON ใน database) */
export function createDefaultMaintenancePayload() {
    return {
        notifiedAt: '',
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
            planning: '',
            approver: '',
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
    return {
        ...base,
        ...raw,
        workType: { ...base.workType, ...(raw.workType || {}) },
        signatures: { ...base.signatures, ...(raw.signatures || {}) },
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
