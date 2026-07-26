/**
 * locationStreamer.ts
 *
 * Fallback GPS streaming from the driver's phone. When the vehicle's hardware
 * telemetry (MQTT) goes silent during an active job, the backend emits
 * `start_location_stream` to this driver; we begin watching the phone's GPS —
 * including while the app is backgrounded, via an Android foreground service —
 * and POST fixes (via locationQueue) every UPDATE_INTERVAL_MS until the backend
 * emits `stop_location_stream` (i.e. real vehicle telemetry has resumed).
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { socket } from './socket';
import { enqueueFix, flushQueue, clearQueue } from './locationQueue';

const LOCATION_TASK = 'circor-background-location';
const UPDATE_INTERVAL_MS = 3000;

let active = false;
let currentJob: { job_id: string | number; vehicle_id: string | number } | null = null;
let registered = false;

// Must be defined at module scope (not inside a component) so Expo can invoke
// it even when the app is backgrounded and this is the only JS running.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error || !active || !currentJob) return;

    const { locations } = (data as { locations: Location.LocationObject[] }) ?? { locations: [] };
    const loc = locations?.[locations.length - 1];
    if (!loc) return;

    // Delivery is over HTTP, not the socket. Socket.IO's reconnect/heartbeat run
    // on JS timers that Android freezes in the background, so after a network
    // blackout the socket stays a zombie until the app is foregrounded — which is
    // exactly the bug this replaces. A one-shot POST has no such timers: we persist
    // every fix and flush on each tick, so a reconnect is picked up on the very
    // next GPS event with no foregrounding. (The socket stays connected only for
    // receiving start/stop_location_stream control messages.)
    const speedMs = loc.coords.speed;
    const headingDeg = loc.coords.heading;
    await enqueueFix({
        job_id: currentJob.job_id,
        vehicle_id: currentJob.vehicle_id,
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        // expo reports speed in m/s; backend/MQTT semantics are km/h
        spd: speedMs != null && speedMs >= 0 ? speedMs * 3.6 : 0,
        head: headingDeg != null && headingDeg >= 0 ? headingDeg : -1,
        ts: Math.floor(Date.now() / 1000),
    });
    // Fire-and-forget; internally guarded against overlapping flushes.
    flushQueue();
});

const stopWatching = async () => {
    active = false;
    currentJob = null;
    const started = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK).catch(() => false);
    if (started) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
    }
    // Best-effort delivery of the last buffered fixes before the monitor closes.
    flushQueue();
};

const startWatching = async (payload: { job_id: string | number; vehicle_id: string | number }) => {
    if (active) return; // already streaming
    currentJob = payload;

    // Drop any fixes left over from a previous session. The backend attributes a
    // fix to the driver's CURRENT monitored vehicle, so replaying stale breadcrumbs
    // into a new job would write wrong positions.
    await clearQueue();

    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
        currentJob = null;
        return;
    }
    // Background permission must be requested after foreground is granted.
    // If the driver declines it, updates simply stop once the app backgrounds.
    await Location.requestBackgroundPermissionsAsync();

    active = true;
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: UPDATE_INTERVAL_MS,
        distanceInterval: 0,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
            notificationTitle: 'Circor is tracking this trip',
            notificationBody: 'Sharing your location while vehicle telemetry is unavailable.',
        },
    });
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
