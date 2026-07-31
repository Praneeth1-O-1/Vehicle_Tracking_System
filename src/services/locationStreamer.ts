/**
 * locationStreamer.ts
 *
 * Continuous GPS reporting from the driver's phone for the duration of an active
 * job — including while the screen is off and Android has the device in Doze.
 *
 * Why tracking is NOT socket-driven:
 * The backend asks for phone GPS by emitting `start_location_stream` when the
 * vehicle's MQTT telemetry goes silent. But Socket.IO's reconnect and heartbeat
 * run on JS timers, and Android freezes those the moment the device dozes — so a
 * sleeping phone never receives that event, and exactly when the fallback is
 * needed most it does nothing. Instead we run an Android foreground service for
 * the whole job (Doze does not throttle foreground-service location) and let the
 * HTTP response tell us the cadence:
 *
 *   standby  — job active, vehicle telemetry healthy. GPS still runs; we POST a
 *              heartbeat every PROBE_INTERVAL_MS. The backend drops these fixes
 *              but reports `streaming` back on the response.
 *   active   — backend reported streaming: true (vehicle telemetry is stale, our
 *              fixes are being persisted). We POST on every tick.
 *
 * The socket listeners remain as an instant-response optimisation for when the
 * app happens to be awake; they only shortcut a state the probe would reach
 * within PROBE_INTERVAL_MS anyway.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { socket, ensureSocketConnected } from './socket';
import { enqueueFix, flushQueue, clearQueue } from './locationQueue';

const LOCATION_TASK = 'circor-background-location';

// GPS sampling cadence. One rate for both modes: switching it would mean
// restarting the location updates (and the foreground service with them), and a
// service restart is precisely what we cannot risk on an OEM-throttled device.
const UPDATE_INTERVAL_MS = 5000;
// How often we POST while stopped and the socket is DOWN — we are blind to start
// commands, so this bounds how long a telemetry outage can go unnoticed.
const PROBE_INTERVAL_MS = 15000;
// How often we POST while stopped and the socket claims to be UP. A mobile
// socket routinely goes zombie — `connected` stays true while the TCP is long
// dead and no emit will ever arrive — so "the socket will tell us" is never
// trusted outright. This is the backstop against a silently lost start command.
const SAFETY_PROBE_INTERVAL_MS = 60000;

/* ── Adaptive reporting while parked ─────────────────────────────────────────
 *
 * A vehicle sitting at a customer for 20 minutes produces ~240 identical fixes
 * at full rate. Dispatch learns nothing from fixes 2..240 that fix 1 did not
 * already tell them, so while stationary we drop to a heartbeat.
 *
 * Note this throttles the REPORTING, not the GPS request. Lowering the sampling
 * rate would mean restarting location updates, and expo-location refuses to
 * (re)start its foreground service while the app is backgrounded — a restart
 * from the background silently downgrades us to a plain background request that
 * Doze then kills. Likewise `distanceInterval` cannot be used as the throttle:
 * it would suppress the task callback entirely while parked, and that callback
 * is what drives the socket keepalive and the control-channel probe.
 */
// Below this displacement from the last reported fix, treat the vehicle as
// parked. Comfortably above typical stationary GPS jitter.
const STATIONARY_RADIUS_M = 15;
// Report at least this often even when parked, so dispatch can tell "stopped
// here" apart from "the phone died".
const STATIONARY_HEARTBEAT_MS = 60000;

let lastReported: { lat: number; lon: number; ms: number } | null = null;

/** Metres between two nearby fixes. Equirectangular — exact enough at this scale. */
const metresBetween = (
    a: { lat: number; lon: number },
    b: { lat: number; lon: number }
): number => {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const x = (b.lon - a.lon) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
    const y = (b.lat - a.lat) * toRad;
    return Math.sqrt(x * x + y * y) * R;
};

export interface TrackedJob {
    job_id: string | number;
    vehicle_id: string | number;
}

// The OS may kill and re-create the JS context between location callbacks while
// the app is backgrounded. Module state does not survive that, so the job under
// tracking is persisted — without it a restarted context would wake up with no
// job and silently discard every fix.
const ACTIVE_JOB_KEY = 'circor.activeTrackingJob';

let registered = false;
let lastFlushMs = 0;
let streaming = false;

/**
 * Reading the tracked job has three outcomes, and they must not be collapsed:
 * a genuine "no job" means shut the service down, whereas a storage read that
 * simply failed means try again later. Returning null for both let one transient
 * AsyncStorage error tear down the foreground service permanently, mid-trip,
 * with nothing left running to restart it.
 */
type TrackedJobRead =
    | { status: 'ok'; job: TrackedJob }
    | { status: 'none' }
    | { status: 'error' };

const readTrackedJobResult = async (): Promise<TrackedJobRead> => {
    let raw: string | null;
    try {
        raw = await AsyncStorage.getItem(ACTIVE_JOB_KEY);
    } catch {
        return { status: 'error' };
    }

    if (!raw) return { status: 'none' };

    try {
        const parsed = JSON.parse(raw);
        if (parsed?.job_id != null && parsed?.vehicle_id != null) {
            return { status: 'ok', job: parsed };
        }
    } catch {
        // Corrupt value — genuinely unusable, not a transient failure.
        return { status: 'none' };
    }
    return { status: 'none' };
};

const readTrackedJob = async (): Promise<TrackedJob | null> => {
    const res = await readTrackedJobResult();
    return res.status === 'ok' ? res.job : null;
};

const writeTrackedJob = async (job: TrackedJob | null): Promise<void> => {
    try {
        if (job) {
            await AsyncStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
        } else {
            await AsyncStorage.removeItem(ACTIVE_JOB_KEY);
        }
    } catch {
        // Non-fatal: we lose crash-resilience for this session, not the stream.
    }
};

const isTaskRunning = async (): Promise<boolean> => {
    try {
        return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    } catch {
        return false;
    }
};

// Must be defined at module scope (not inside a component) so Expo can invoke it
// even when the app is backgrounded and this is the only JS running.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error) return;

    const read = await readTrackedJobResult();
    if (read.status === 'error') {
        // Storage hiccup, not a finished job. Skip this tick and keep the service
        // alive — stopping here would end the trip's tracking for good.
        return;
    }
    if (read.status === 'none') {
        // Nothing to report for — e.g. the context was rebuilt after logout, or
        // the service outlived the job. Shut the service down rather than burn
        // battery on fixes nobody will accept.
        await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => { });
        return;
    }
    const job = read.job;

    const { locations } = (data as { locations: Location.LocationObject[] }) ?? { locations: [] };
    const loc = locations?.[locations.length - 1];
    if (!loc) return;

    // Give the control channel a heartbeat off the back of the foreground
    // service. Socket.IO's own reconnect timers are frozen while backgrounded,
    // so without this the socket never comes back and start/stop commands never
    // arrive. Once it reconnects the backend re-sends start_location_stream if
    // this driver's job is already in fallback (see socketUtils.js).
    ensureSocketConnected().catch(() => { });

    // While stopped we still POST occasionally — rarely if the socket looks
    // healthy, often if it is down — because the response is the only channel
    // that reaches a dozing phone. Anything more than that is battery burned on
    // fixes the backend will discard.
    const now = Date.now();
    if (!streaming) {
        const due = socket.connected ? SAFETY_PROBE_INTERVAL_MS : PROBE_INTERVAL_MS;
        if (now - lastFlushMs < due) return;
    } else if (lastReported) {
        // Streaming, but parked: send a heartbeat rather than a redundant fix.
        // Displacement is measured against the last fix we actually REPORTED, so
        // a slow crawl still accumulates past the radius and resumes full rate.
        const moved = metresBetween(lastReported, {
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
        }) >= STATIONARY_RADIUS_M;
        if (!moved && now - lastReported.ms < STATIONARY_HEARTBEAT_MS) return;
    }

    const speedMs = loc.coords.speed;
    const headingDeg = loc.coords.heading;
    await enqueueFix({
        job_id: job.job_id,
        vehicle_id: job.vehicle_id,
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        // expo reports speed in m/s; backend/MQTT semantics are km/h
        spd: speedMs != null && speedMs >= 0 ? speedMs * 3.6 : 0,
        head: headingDeg != null && headingDeg >= 0 ? headingDeg : -1,
        ts: Math.floor(Date.now() / 1000),
    });

    lastReported = { lat: loc.coords.latitude, lon: loc.coords.longitude, ms: now };
    lastFlushMs = now;
    const serverState = await flushQueue();
    // The response is authoritative — it reflects the monitor as of right now,
    // whereas a socket command may have been missed or gone stale.
    if (serverState) streaming = serverState.streaming;
});

/**
 * Begin (or continue) reporting for `job`. Idempotent: calling it repeatedly for
 * the same job is a no-op, so it is safe to drive from a jobs-list refresh.
 *
 * Returns false when location permission is missing — the caller should surface
 * the permission prompt.
 */
export const startTracking = async (job: TrackedJob): Promise<boolean> => {
    const current = await readTrackedJob();
    const sameJob = current
        && String(current.job_id) === String(job.job_id)
        && String(current.vehicle_id) === String(job.vehicle_id);

    if (sameJob && await isTaskRunning()) return true;

    // Fixes are attributed to the driver's current monitored vehicle server-side,
    // so replaying breadcrumbs from a previous job would write wrong positions.
    if (!sameJob) await clearQueue();

    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') return false;
    // Without background permission Android stops delivering updates as soon as
    // the app leaves the foreground, which defeats the entire purpose here.
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== 'granted') return false;

    await writeTrackedJob(job);
    // Only reset on a genuine job switch. Resetting unconditionally would clobber
    // the flag a `start_location_stream` handler had just set on its way here.
    if (!sameJob) {
        streaming = false;
        // Force a first report for the new job rather than comparing against
        // wherever the previous one ended.
        lastReported = null;
    }
    lastFlushMs = 0;

    if (await isTaskRunning()) return true;

    // expo-location silently skips starting its foreground service when the app
    // is backgrounded (LocationTaskConsumer.maybeStartForegroundService). Going
    // ahead anyway would register a plain background location request that looks
    // healthy and then gets killed by Doze — worse than not starting, because
    // nothing would report the failure. Wait for the app to be foregrounded.
    if (AppState.currentState !== 'active') return false;

    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: UPDATE_INTERVAL_MS,
        distanceInterval: 0,
        // Android: batching would hold fixes back for the OS to deliver in bursts,
        // trading exactly the freshness this stream exists to provide.
        deferredUpdatesInterval: 0,
        deferredUpdatesDistance: 0,
        // iOS: the OS pauses updates when it decides the user has stopped moving,
        // and only resumes on significant motion — a parked-then-departing vehicle
        // would go dark. Also keeps the blue in-use bar visible, as required.
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.AutomotiveNavigation,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
            notificationTitle: 'Circor is tracking this trip',
            notificationBody: 'Sharing your location so dispatch can follow this job.',
            notificationColor: '#1D1D1F',
            // Keep the service alive when the driver swipes the app away — the
            // trip is still running even if the task card is gone.
            killServiceOnDestroy: false,
        },
    });
    return true;
};

/** Stop reporting and shut the foreground service down. */
export const stopTracking = async (): Promise<void> => {
    await writeTrackedJob(null);
    streaming = false;
    lastReported = null;
    if (await isTaskRunning()) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => { });
    }
    // Best-effort delivery of whatever is still buffered.
    flushQueue();
};

/**
 * Wire the backend's start/stop commands.
 *
 * Registered at module scope, NOT from a screen: when Android rebuilds the JS
 * context to deliver a background location update there is no mounted component
 * to run an effect, but the bundle is re-evaluated — so module scope is the only
 * place a listener is guaranteed to exist while the app is backgrounded.
 */
const registerControlListeners = () => {
    if (registered) return;
    registered = true;

    socket.on('start_location_stream', (payload: TrackedJob) => {
        streaming = true;
        lastFlushMs = 0;
        // Begin transmitting immediately rather than waiting for the next GPS
        // tick, and make sure the service is up if this arrived before tracking
        // was started (a no-op when it is already running).
        startTracking(payload)
            .then(() => flushQueue())
            .then((state) => { if (state) streaming = state.streaming; })
            .catch(() => { });
    });

    socket.on('stop_location_stream', () => {
        // Deliver what is still buffered BEFORE going quiet. Those fixes were
        // taken while the vehicle was genuinely dark, so they belong to the hole
        // the fallback just covered — the backend admits them on their own
        // timestamps, but only if we actually send them.
        flushQueue()
            .catch(() => { })
            .then(() => { streaming = false; });
    });
};

/* ── Watchdog ─────────────────────────────────────────────────────────────────
 *
 * startTracking can fail for reasons that are entirely recoverable later —
 * the app was backgrounded when the job appeared (expo-location refuses to
 * start its foreground service from the background), or "Allow all the time"
 * had not been granted yet. It reported that by returning false, which every
 * caller discarded, and nothing ever asked again: one failed start meant a
 * whole trip with no phone GPS.
 *
 * Android also kills foreground services on its own — OEM battery managers,
 * low memory, a swipe-away on some ROMs. The service is not something we can
 * start once and assume; it has to be checked.
 *
 * So: re-assert on every foreground, and on a timer while the app is alive.
 */
const WATCHDOG_INTERVAL_MS = 60000;

let watchdogId: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;

/** Restart the location service if a job is tracked but nothing is running. */
const reassertTracking = async (): Promise<void> => {
    try {
        const job = await readTrackedJob();
        if (!job) return;
        if (await isTaskRunning()) return;
        await startTracking(job);
    } catch {
        // Never let the watchdog throw into a timer or an AppState callback.
    }
};

const startWatchdog = () => {
    if (!watchdogId) {
        watchdogId = setInterval(() => { reassertTracking(); }, WATCHDOG_INTERVAL_MS);
    }
    if (!appStateSub) {
        appStateSub = AppState.addEventListener('change', (next) => {
            // The one moment a start that failed while backgrounded can succeed.
            if (next === 'active') reassertTracking();
        });
    }
};

const stopWatchdog = () => {
    if (watchdogId) {
        clearInterval(watchdogId);
        watchdogId = null;
    }
    if (appStateSub) {
        appStateSub.remove();
        appStateSub = null;
    }
};

registerControlListeners();

/**
 * Kept for the Dashboard to call on mount. Listener registration already
 * happened at module load; this only re-arms it after an explicit teardown.
 */
export const initLocationStreamer = () => {
    registerControlListeners();
    startWatchdog();
    // Catch a service that died while the app was away, without waiting a full
    // watchdog interval.
    reassertTracking();
};

/** Remove listeners and stop tracking (call on logout). */
export const teardownLocationStreamer = () => {
    socket.off('start_location_stream');
    socket.off('stop_location_stream');
    stopWatchdog();
    stopTracking();
    registered = false;
};
