import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
    baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export const authService = {
    login: (mxid: string, password: string) => 
        api.post('/auth/login', { mxid, password }),
    me: () => api.get('/auth/me'),
};

export const memberService = {
    list: () => api.get('/members'),
    create: (data: any) => api.post('/members', data),
    update: (id: string, data: any) => api.patch(`/members/${id}`, data),
    delete: (id: string) => api.delete(`/members/${id}`),
    deleteAll: () => api.delete('/members'),
    importPk: (data: any) => api.post('/import/pluralkit', data),
    exportPk: () => {
        const token = localStorage.getItem('token');
        window.open(`${API_BASE}/export/pluralkit?token=${token}`, '_blank');
    },
    exportMedia: () => {
        const token = localStorage.getItem('token');
        window.open(`${API_BASE}/media/export?token=${token}`, '_blank');
    },
    importMedia: (file: File) => {
        return api.post('/media/import', file, {
            headers: { 'Content-Type': 'application/zip' }
        });
    },
    uploadMedia: (file: File) => {
        return api.post(`/media/upload?filename=${encodeURIComponent(file.name)}`, file, {
            headers: { 'Content-Type': file.type }
        });
    }
};

export const systemService = {
    get: () => api.get('/system'),
    update: (data: any) => api.patch('/system', data),
    getLinks: () => api.get('/system/links'),
    createLink: (targetMxid: string) => api.post('/system/links', { targetMxid }),
    setPrimaryLink: (targetMxid: string) => api.post('/system/links/primary', { targetMxid }),
    deleteLink: (mxid: string) => api.delete(`/system/links/${encodeURIComponent(mxid)}`),
};

export default api;
