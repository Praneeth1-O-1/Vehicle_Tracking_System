import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Remote server (uncomment to use production):
const API_URL = 'http://51.20.128.131';

// Local backend — use your PC's LAN IP (not localhost) so the phone can reach it
//const API_URL = 'http://10.63.55.139:5001';

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

// GET DRIVER'S JOBS
export const getDriverJobs = async () => {
    const userJson = await SecureStore.getItemAsync('user');
    const user = userJson ? JSON.parse(userJson) : null;
    const driverId = user?.user_id;

    if (!driverId) return [];

    const response = await api.get(`/api/jobs/driverJobs/${driverId}`);

    const jobs = response.data?.DATA;
    return Array.isArray(jobs) ? jobs : [];
};

// UPDATE STOP STATUS (completed, pending, interrupted)
export const updateStopStatus = async (
    job_id: string | number,
    task_id: string,
    status: string,
    reason?: string,
    latitude?: number,
    longitude?: number
) => {
    const response = await api.put('/api/jobs/status', {
        job_id,
        task_id,
        status,
        reason: reason || undefined,
        latitude: latitude ?? undefined,
        longitude: longitude ?? undefined,
    });
    return response.data;
};

// START TRIP — records actual start location, recalculates ETA
export const startTrip = async (
    job_id: string | number,
    latitude: number,
    longitude: number
) => {
    const response = await api.post('/api/driver/startTrip', {
        job_id,
        timestamp: new Date().toISOString(),
        latitude,
        longitude,
    });
    return response.data;
};

// REPORT VEHICLE BREAKDOWN — sends GPS + vehicle_id, backend handles email
export const reportBreakdown = async (
    vehicle_id: string | number,
    job_id: string | number,
    lat: number,
    lng: number
) => {
    const response = await api.post('/api/jobs/reportBreakdown', {
        vehicle_id,
        job_id,
        lat,
        long: lng,
    });
    return response.data;
};

// ─── AUDIO API ─────────────────────────────────────────────

// UPLOAD TASK EXPLANATION (late task audio)
export const uploadTaskExplanation = async (
    audioUri: string,
    job_id: string | number,
    task_id: string,
    duration_secs?: number
) => {
    const formData = new FormData();
    formData.append('audio', {
        uri: audioUri,
        type: 'audio/mp4',
        name: `task_explanation_${job_id}_${task_id}.m4a`,
    } as any);
    formData.append('job_id', String(job_id));
    formData.append('task_id', String(task_id));
    if (duration_secs != null) formData.append('duration_secs', String(duration_secs));

    const response = await api.post('/api/audio/task-explanation', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
};

// SEND DIRECT AUDIO MESSAGE
export const sendAudioMessage = async (
    audioUri: string,
    receiver_id: string | number,
    duration_secs?: number
) => {
    const formData = new FormData();
    formData.append('audio', {
        uri: audioUri,
        type: 'audio/mp4',
        name: `message_to_${receiver_id}.m4a`,
    } as any);
    formData.append('receiver_id', String(receiver_id));
    if (duration_secs != null) formData.append('duration_secs', String(duration_secs));

    const response = await api.post('/api/audio/message', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
};

// GET CONVERSATIONS LIST
export const getConversations = async () => {
    const response = await api.get('/api/audio/conversations');
    return response.data?.DATA || [];
};

// GET CONVERSATION MESSAGES WITH A USER
export const getConversationMessages = async (userId: string | number) => {
    const response = await api.get(`/api/audio/conversation/${userId}`);
    return response.data?.DATA || [];
};

// GET AUDIO STREAM URL (for playback)
export const getAudioStreamUrl = (messageId: string | number) => {
    return `${API_URL}/api/audio/stream/${messageId}`;
};

// GET UNREAD MESSAGE COUNT
export const getUnreadCount = async () => {
    const response = await api.get('/api/audio/unread-count');
    return response.data?.DATA?.count || 0;
};

// GET USERS AVAILABLE FOR MESSAGING
export const getMessagableUsers = async () => {
    const response = await api.get('/api/audio/users');
    return response.data?.DATA || [];
};

export default api;
