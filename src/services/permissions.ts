/**
 * permissions.ts
 *
 * Location permission state for the always-on trip stream.
 *
 * The app needs "Allow all the time" (ACCESS_BACKGROUND_LOCATION), not just
 * while-in-use: the whole point of the tracker is to keep reporting with the
 * screen off. Android 11+ refuses to grant that from a runtime dialog — the
 * driver has to pick it in system settings — so `blocked` is a normal outcome
 * here, not an error, and the UI must route to settings rather than re-ask.
 */

import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

export type LocationPermissionState =
    /** Foreground + background both granted — background tracking will work. */
    | 'granted'
    /** While-in-use only. Tracking stops as soon as the app is backgrounded. */
    | 'foreground-only'
    /** Nothing granted, but the system will still show a dialog if we ask. */
    | 'denied'
    /** Nothing granted and the system will no longer prompt — settings only. */
    | 'blocked';

export const isTrackingUsable = (state: LocationPermissionState): boolean =>
    state === 'granted';

/** Read current status without prompting. */
export const checkLocationPermissions = async (): Promise<LocationPermissionState> => {
    try {
        const fg = await Location.getForegroundPermissionsAsync();
        if (fg.status !== 'granted') {
            return fg.canAskAgain ? 'denied' : 'blocked';
        }
        const bg = await Location.getBackgroundPermissionsAsync();
        return bg.status === 'granted' ? 'granted' : 'foreground-only';
    } catch {
        return 'denied';
    }
};

/**
 * Prompt for whatever is still missing, foreground first (the OS requires that
 * order). Resolves with the state after prompting.
 */
export const requestLocationPermissions = async (): Promise<LocationPermissionState> => {
    try {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status !== 'granted') {
            return fg.canAskAgain ? 'denied' : 'blocked';
        }

        const bg = await Location.requestBackgroundPermissionsAsync();
        return bg.status === 'granted' ? 'granted' : 'foreground-only';
    } catch {
        return 'denied';
    }
};

/** Open this app's system settings page (where "Allow all the time" lives). */
export const openLocationSettings = async (): Promise<void> => {
    try {
        await Linking.openSettings();
    } catch {
        // Nothing further we can do from inside the app.
    }
};

/* ── Doze / battery optimisation ─────────────────────────────────────────────
 *
 * Backgrounded and asleep are not the same problem. A foreground service is
 * enough to keep location and network alive while the app is merely
 * backgrounded, but once the screen has been off long enough the device enters
 * Doze and the system suspends network access, ignores wake locks, and defers
 * background work — which would strand the trip stream mid-shift.
 *
 * Being on the battery-optimisation exemption list is what lifts those Doze
 * restrictions. It is the single setting that decides whether tracking survives
 * a sleeping phone, so it is checked and reported, not just linked to.
 */

/** True when the app is exempt from Doze restrictions. Always true off Android. */
export const isBatteryOptimizationExempt = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
        // expo-battery reports whether optimisation is ENABLED for us; exempt is
        // the inverse.
        return !(await Battery.isBatteryOptimizationEnabledAsync());
    } catch {
        // Unknown — assume exempt rather than nagging on a false negative.
        return true;
    }
};

const androidPackageName = (): string | null =>
    Constants.expoConfig?.android?.package ?? null;

/**
 * Ask for the Doze exemption. Prefers the system's direct "Allow?" dialog for
 * this specific app, falling back to the general list when the package name is
 * unavailable or the OEM has removed that activity. No-op off Android.
 */
export const requestBatteryOptimizationExemption = async (): Promise<void> => {
    if (Platform.OS !== 'android') return;

    const pkg = androidPackageName();
    if (pkg) {
        try {
            await IntentLauncher.startActivityAsync(
                'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
                { data: `package:${pkg}` }
            );
            return;
        } catch {
            // Some OEMs strip this activity — fall through to the list.
        }
    }

    try {
        await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    } catch {
        await openLocationSettings();
    }
};
