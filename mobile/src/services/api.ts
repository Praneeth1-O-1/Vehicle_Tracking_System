import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const API_URL = 'http://51.20.128.131';

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

export default api;
