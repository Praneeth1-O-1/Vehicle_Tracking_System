import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Dynamic Host Configuration
// const getBaseUrl = () => {
//     if (Constants.expoConfig?.hostUri) {
//         const host = Constants.expoConfig.hostUri.split(':')[0];
//         return `http://${host}:5001`;
//     }
//     return Platform.OS === 'android' ? 'http://10.0.2.2:5001' : 'http://localhost:5001';
// };

// const API_URL = getBaseUrl();

const API_URL = 'http://51.20.128.131';

console.log("Using API URL:", API_URL);

const api = axios.create({
    baseURL: API_URL,
});

// Add Token to Requests
api.interceptors.request.use(async (config) => {
    const token = await SecureStore.getItemAsync('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// LOGIN
export const login = async (username: string, password: string) => {
    const response = await api.post('/api/auth/login', { username, password });
    const { DATA } = response.data;

    if (DATA && DATA.token) {
        await SecureStore.setItemAsync('token', DATA.token);
        await SecureStore.setItemAsync('user', JSON.stringify(DATA));
        return DATA;
    } else {
        throw new Error('Invalid response from server');
    }
};

// GET DRIVER'S JOBS — uses dedicated /api/jobs/driverJobs/:driver_id endpoint
export const getDriverJobs = async () => {
    const userJson = await SecureStore.getItemAsync('user');
    const user = userJson ? JSON.parse(userJson) : null;
    const driverId = user?.user_id;

    if (!driverId) return [];

    const response = await api.get(`/api/jobs/driverJobs/${driverId}`);

    // Backend returns { MESSAGE, COUNT, DATA: [...] }
    const jobs = response.data?.DATA;
    return Array.isArray(jobs) ? jobs : [];
};

// UPDATE STOP STATUS (completed, pending)
export const updateStopStatus = async (
    job_id: string | number,
    task_id: string,
    status: string,
    reason?: string
) => {
    const response = await api.put('/api/jobs/status', {
        job_id,
        task_id,
        status,
        reason: reason || undefined,
    });
    return response.data;
};

// UPLOAD VOICE NOTE for delay reason
export const uploadVoiceNote = async (
    job_id: string | number,
    task_id: string,
    audioUri: string
) => {
    const formData = new FormData();
    formData.append('job_id', String(job_id));
    formData.append('task_id', String(task_id));

    // Build the file object for React Native FormData
    const ext = audioUri.split('.').pop() || 'm4a';
    const mimeType = ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
    formData.append('audio', {
        uri: audioUri,
        name: `recording.${ext}`,
        type: mimeType,
    } as any);

    const response = await api.post('/api/delay/upload-voice', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
};

// REPORT VEHICLE BREAKDOWN
export const reportBreakdown = async (job_id: string | number) => {
    const response = await api.post('/api/jobs/breakdown', { job_id });
    return response.data;
};

export default api;
