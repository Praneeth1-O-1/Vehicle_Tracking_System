/**
 * locationStreamer.ts
 *
 * Fallback GPS streaming from the driver's phone. When the vehicle's hardware
 * telemetry (MQTT) goes silent during an active job, the backend emits
 * `start_location_stream` to this driver; we begin watching the phone's GPS and
 * emit `mobile_location` fixes until the backend emits `stop_location_stream`
 * (i.e. real vehicle telemetry has resumed).
 */

import * as Location from 'expo-location';
import { socket } from './socket';

let watcher: Location.LocationSubscription | null = null;
let active = false;
let currentJob: { job_id: string | number; vehicle_id: string | number } | null = null;
let registered = false;

const stopWatching = () => {
    if (watcher) {
        watcher.remove();
        watcher = null;
    }
    active = false;
    currentJob = null;
};

const startWatching = async (payload: { job_id: string | number; vehicle_id: string | number }) => {
    if (active) return; // already streaming
    active = true;
    currentJob = payload;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
        active = false;
        currentJob = null;
        return;
    }

    watcher = await Location.watchPositionAsync(
        {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 10,
        },
        (loc) => {
            if (!active || !currentJob) return;
            const speedMs = loc.coords.speed;
            const headingDeg = loc.coords.heading;
            socket.emit('mobile_location', {
                job_id: currentJob.job_id,
                vehicle_id: currentJob.vehicle_id,
                lat: loc.coords.latitude,
                lon: loc.coords.longitude,
                // expo reports speed in m/s; backend/MQTT semantics are km/h
                spd: speedMs != null && speedMs >= 0 ? speedMs * 3.6 : 0,
                head: headingDeg != null && headingDeg >= 0 ? headingDeg : -1,
                ts: Math.floor(Date.now() / 1000),
            });
        }
    );
};

/**
 * Register socket listeners once. Safe to call on every Dashboard mount.
 */
export const initLocationStreamer = () => {
    if (registered) return;
    registered = true;

    socket.on('start_location_stream', (payload: { job_id: string | number; vehicle_id: string | number }) => {
        startWatching(payload).catch(() => stopWatching());
    });

    socket.on('stop_location_stream', () => {
        stopWatching();
    });
};

/**
 * Remove listeners and stop any active watch (call on logout / unmount).
 */
export const teardownLocationStreamer = () => {
    socket.off('start_location_stream');
    socket.off('stop_location_stream');
    stopWatching();
    registered = false;
};
