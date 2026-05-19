import axios from 'axios';

const API_BASE_URL = '/api';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
});

// Add token to requests if available
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    // If FormData, remove Content-Type header to let browser set it with boundary
    if (config.data instanceof FormData) {
        delete config.headers['Content-Type'];
    }
    return config;
});

// Handle 401 errors - only for protected routes
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            const url = error.config?.url || '';
            const onProductionPage = typeof window !== 'undefined'
                && window.location.pathname.startsWith('/production-monitoring');
            const isProdMonApi = url.includes('production-monitor');
            if (url.includes('/admin/') || url.includes('/me') || url.includes('/logout')
                || url.includes('/maintenance-requests') || url.includes('/maintenance-notifications')
                || (onProductionPage && isProdMonApi)) {
                localStorage.removeItem('auth_token');
                localStorage.removeItem('auth_user');
                // Only redirect if not already on login page
                if (!window.location.pathname.includes('/admin/login')) {
                    window.location.href = '/admin/login';
                }
            }
        }
        return Promise.reject(error);
    }
);

export const authAPI = {
    login: (username, password) => api.post('/login', { username, password }),
    logout: () => api.post('/logout'),
    me: () => api.get('/me'),
};

/** ใบแจ้งซ่อม FR-MTN-04 — ต้องล็อกอิน */
export const maintenanceAPI = {
    list: (params) => api.get('/maintenance-requests', { params }),
    get: (id) => api.get(`/maintenance-requests/${id}`),
    create: (formData) => api.post('/maintenance-requests', formData),
    update: (id, formData) => api.post(`/maintenance-requests/${id}`, formData),
    approve: (id, data) => api.post(`/maintenance-requests/${id}/approve`, data),
    reject: (id, data) => api.post(`/maintenance-requests/${id}/reject`, data),
    technicianComplete: (id) => api.post(`/maintenance-requests/${id}/technician-complete`),
    ownerSubmitInspection: (id, formData) => api.post(`/maintenance-requests/${id}/owner-submit-inspection`, formData),
    adminCloseMaintenance: (id, formData) => api.post(`/maintenance-requests/${id}/admin-close`, formData),
    delete: (id) => api.delete(`/maintenance-requests/${id}`),
    /** เปิด PDF ในแท็บใหม่ (ผู้ใช้กดพิมพ์จากเบราว์เซอร์เอง ไม่เรียก print อัตโนมัติ) */
    openPdfForPrint: async (id) => {
        let response;
        try {
            response = await api.get(`/maintenance-requests/${id}/pdf`, {
                responseType: 'arraybuffer',
                headers: { Accept: 'application/pdf' },
            });
        } catch (err) {
            const d = err.response?.data;
            let msg = 'โหลด PDF ไม่สำเร็จ';
            if (d instanceof ArrayBuffer) {
                try {
                    const j = JSON.parse(new TextDecoder('utf-8').decode(d));
                    if (j.message) msg = j.message;
                } catch {
                    /* keep default */
                }
            } else if (err.response?.data?.message) {
                msg = err.response.data.message;
            }
            throw new Error(msg);
        }
        const buf = response.data;
        const bytes = new Uint8Array(buf);
        const head =
            bytes.length >= 4
                ? String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
                : '';
        if (head !== '%PDF') {
            let msg = 'ได้รับข้อมูลที่ไม่ใช่ PDF (อาจเป็นข้อความผิดพลาดจากเซิร์ฟเวอร์)';
            try {
                const j = JSON.parse(new TextDecoder('utf-8').decode(buf));
                if (j.message) msg = j.message;
            } catch {
                /* */
            }
            throw new Error(msg);
        }
        const blob = new Blob([buf], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const pdfTab = window.open(url, '_blank');
        if (!pdfTab) {
            window.URL.revokeObjectURL(url);
            throw new Error('POPUP_BLOCKED');
        }
        try {
            pdfTab.focus();
        } catch {
            /* */
        }
        // อย่า revoke blob เร็ว — บางเบราว์เซอร์โหลด PDF/ทรัพยากรในเอกสารยังไม่จบ จะได้ตัวว่างหรือไม่มีรูป
    },
    notifications: () => api.get('/maintenance-notifications'),
    unreadCount: () => api.get('/maintenance-notifications/unread-count'),
    markNotificationRead: (id) => api.post(`/maintenance-notifications/${id}/read`),
    markAllNotificationsRead: () => api.post('/maintenance-notifications/read-all'),
    deleteNotification: (id) => api.delete(`/maintenance-notifications/${id}`),
    deleteAllNotifications: () => api.delete('/maintenance-notifications'),
};

export const publicAPI = {
    getHome: () => api.get('/home'),
    getPageContent: (key) => api.get(`/page-content/${key}`),
    getProblems: (params) => api.get('/problems', { params }),
    getProblem: (id) => api.get(`/problems/${id}`),
    getCategories: () => api.get('/categories'),
    // Machines
    getMachines: () => api.get('/machines'),
    getMachine: (id) => api.get(`/machines/${id}`),
    getMachineZones: (machineId) => api.get(`/machines/${machineId}/zones`),
    getMachineZone: (id) => api.get(`/machine-zones/${id}`),
    getMachineZoneProblems: (zoneId, params) => api.get(`/machine-zones/${zoneId}/problems`, { params }),
    getMachineZoneProblem: (id) => api.get(`/machine-zone-problems/${id}`),
    // AI Gems
    getAiGems: () => api.get('/ai-gems'),
};

export const adminAPI = {
    // Problems
    getAllProblems: (params) => api.get('/admin/problems', { params }),
    createProblem: (formData) => api.post('/admin/problems', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    }),
    updateProblem: (id, formData) => {
        // Use POST with method spoofing for file uploads - Laravel handles FormData better with POST
        formData.append('_method', 'PUT');
        return api.post(`/admin/problems/${id}`, formData);
    },
    deleteProblem: (id) => api.delete(`/admin/problems/${id}`),
    
    // Categories
    getAllCategories: () => api.get('/admin/categories'),
    createCategory: (data) => api.post('/admin/categories', data),
    updateCategory: (id, data) => api.put(`/admin/categories/${id}`, data),
    deleteCategory: (id) => api.delete(`/admin/categories/${id}`),
    
    // Users
    getUsers: () => api.get('/admin/users'),
    createUser: (data) => api.post('/admin/users', data),
    updateUser: (id, data) => api.put(`/admin/users/${id}`, data),
    deleteUser: (id) => api.delete(`/admin/users/${id}`),
    
    // Page Contents
    getPageContents: () => api.get('/admin/page-contents'),
    getPageContent: (id) => api.get(`/admin/page-contents/${id}`),
    createPageContent: (data) => api.post('/admin/page-contents', data),
    updatePageContent: (id, data) => api.put(`/admin/page-contents/${id}`, data),
    updatePageContentByKey: (key, data) => api.put(`/admin/page-contents/key/${key}`, data),
    deletePageContent: (id) => api.delete(`/admin/page-contents/${id}`),
    
    // Machines
    getAllMachines: () => api.get('/admin/machines'),
    createMachine: (formData) => api.post('/admin/machines', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    }),
    updateMachine: (id, formData) => {
        // Add _method for method spoofing
        formData.append('_method', 'PUT');
        // Don't set Content-Type header - let axios set it automatically with boundary
        return api.post(`/admin/machines/${id}`, formData);
    },
    deleteMachine: (id) => api.delete(`/admin/machines/${id}`),
    
    // Machine Zones
    getAllMachineZones: (machineId) => api.get(`/admin/machines/${machineId}/zones`),
    createMachineZone: (formData) => api.post('/admin/machine-zones', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    }),
    updateMachineZone: (id, formData) => {
        // Add _method for method spoofing
        formData.append('_method', 'PUT');
        // Don't set Content-Type header - let axios set it automatically with boundary
        return api.post(`/admin/machine-zones/${id}`, formData);
    },
    deleteMachineZone: (id) => api.delete(`/admin/machine-zones/${id}`),
    
    // Machine Zone Problems
    getAllMachineZoneProblems: (zoneId, params) => api.get(`/admin/machine-zones/${zoneId}/problems`, { params }),
    createMachineZoneProblem: (formData) => api.post('/admin/machine-zone-problems', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    }),
    updateMachineZoneProblem: (id, formData) => {
        // Use POST with method spoofing for file uploads - Laravel handles FormData better with POST
        formData.append('_method', 'PUT');
        return api.post(`/admin/machine-zone-problems/${id}`, formData);
    },
    deleteMachineZoneProblem: (id) => api.delete(`/admin/machine-zone-problems/${id}`),
    
    // AI Gems
    getAllAiGems: () => api.get('/admin/ai-gems'),
    createAiGem: (data) => api.post('/admin/ai-gems', data),
    updateAiGem: (id, data) => api.put(`/admin/ai-gems/${id}`, data),
    deleteAiGem: (id) => api.delete(`/admin/ai-gems/${id}`),
};

export default api;

