/**
 * locationQueue.ts
 *
 * Persistent, offline-first delivery queue for background GPS fixes.
 *
 * Why this exists: Socket.IO's reconnect/heartbeat run on JS timers that Android
 * freezes while the app is backgrounded, so after a network blackout the socket
 * stays a zombie until the app is foregrounded. A one-shot HTTP POST has no such
 * timers — it either succeeds or fails immediately. We enqueue every fix to
 * AsyncStorage (so it survives the JS context being killed) and flush on each GPS
 * tick; a network reconnect is therefore picked up on the very next fix, with no
 * foregrounding required.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

export interface LocationFix {
    job_id: string | number;
    vehicle_id: string | number;
    lat: number;
    lon: number;
    spd: number;
    head: number;
    ts: number;
}

/**
 * What the backend told us on the last successful POST.
 *
 * `streaming` is the authoritative cadence signal: true means the backend has
 * declared this driver's vehicle telemetry stale and is now persisting our fixes.
 * It arrives on the HTTP response precisely because the socket cannot deliver it
 * to a dozing phone — see locationStreamer.ts.
 */
export interface ServerState {
    streaming: boolean;
}

/** Per-batch delivery outcome, distinct from the monitor state above. */
interface BatchResult {
    /** The server could not store these; keep them and retry on the next tick. */
    retry: boolean;
}

const QUEUE_KEY = 'circor.mobileLocationQueue';
// ~30 min of breadcrumbs at a 3s cadence. Beyond this we drop the OLDEST fixes:
// stale positions are worthless, and an unbounded queue would grow forever if the
// backend were unreachable for a long time.
const MAX_QUEUE = 600;
// Fixes per POST. Keeps each request small so a flush after a long outage drains
// in bounded chunks instead of one huge payload.
const MAX_BATCH = 100;

// Prevents overlapping flushes (the task fires every few seconds). Module-scope
// is fine: the background task and the queue share one JS context.
let flushing = false;

const readQueue = async (): Promise<LocationFix[]> => {
    try {
        const raw = await AsyncStorage.getItem(QUEUE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeQueue = async (queue: LocationFix[]): Promise<void> => {
    try {
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch {
        // Storage failure is non-fatal — we simply lose this persistence attempt.
    }
};

/** Append one fix, trimming the oldest if we exceed the retention cap. */
export const enqueueFix = async (fix: LocationFix): Promise<void> => {
    const queue = await readQueue();
    queue.push(fix);
    const trimmed = queue.length > MAX_QUEUE ? queue.slice(queue.length - MAX_QUEUE) : queue;
    await writeQueue(trimmed);
};

/**
 * Send queued fixes oldest-first in batches. Stops on the first failed POST and
 * leaves the queue intact so the next GPS tick retries. Safe to call fire-and-
 * forget on every tick — concurrent calls are coalesced by the `flushing` guard.
 *
 * Resolves with the backend's monitor state from the last successful POST, or
 * null if nothing was delivered (queue empty, coalesced call, or network down).
 */
export const flushQueue = async (): Promise<ServerState | null> => {
    if (flushing) return null;
    flushing = true;
    let serverState: ServerState | null = null;
    try {
        // Loop so a backlog drains across multiple batches in a single flush.
        for (;;) {
            const queue = await readQueue();
            if (queue.length === 0) break;

            const batch = queue.slice(0, MAX_BATCH);
            let result: BatchResult;
            try {
                const res = await api.post('/api/driver/mobile-location', { fixes: batch });
                serverState = { streaming: Boolean(res?.data?.streaming) };
                result = { retry: Boolean(res?.data?.retry) };
            } catch {
                // Network/server unreachable — keep everything, retry next tick.
                break;
            }

            // A 200 does not by itself mean the fixes were stored. When the server
            // reports it failed on its side (DB/Redis down), deleting the batch
            // here would destroy the only copy — hold it and let the next tick
            // retry. Fixes the server deliberately discarded (already covered by
            // MQTT, or no active job) are not retried: resending them would loop
            // forever on data it will never accept.
            if (result.retry) break;

            // Re-read before trimming: new fixes may have been appended (at the
            // end) while the POST was in flight. Dropping the first batch.length
            // removes exactly what we sent and preserves those new fixes.
            const after = await readQueue();
            await writeQueue(after.slice(batch.length));
        }
    } finally {
        flushing = false;
    }
    return serverState;
};

/** Drop everything (e.g. on logout). */
export const clearQueue = async (): Promise<void> => {
    await writeQueue([]);
};
