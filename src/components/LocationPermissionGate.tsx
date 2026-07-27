/**
 * LocationPermissionGate.tsx
 *
 * Post-login prompt for the always-on location permission. Shown every time the
 * driver lands on the dashboard without "Allow all the time" granted, because
 * without it the trip stream dies the moment the phone sleeps — silently, from
 * the driver's point of view.
 *
 * Re-checks whenever the app returns to the foreground so that coming back from
 * system settings dismisses the prompt on its own.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    AppState,
    AppStateStatus,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../i18n/i18n';
import {
    LocationPermissionState,
    checkLocationPermissions,
    isBatteryOptimizationExempt,
    openLocationSettings,
    requestBatteryOptimizationExemption,
    requestLocationPermissions,
} from '../services/permissions';

interface Props {
    /** Fired whenever location permission lands on fully-granted. */
    onGranted?: () => void;
}

interface StepProps {
    done: boolean;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    detail: string;
}

/** One requirement in the checklist, with its satisfied/outstanding state. */
const Step = ({ done, icon, label, detail }: StepProps) => (
    <View style={st.step}>
        <Ionicons
            name={done ? 'checkmark-circle' : icon}
            size={20}
            color={done ? '#34C759' : '#8A8A8E'}
        />
        <View style={st.stepText}>
            <Text style={[st.stepLabel, done && st.stepLabelDone]}>{label}</Text>
            {!done && <Text style={st.stepDetail}>{detail}</Text>}
        </View>
    </View>
);

const LocationPermissionGate = ({ onGranted }: Props) => {
    const { t } = useTranslation();
    const [state, setState] = useState<LocationPermissionState | null>(null);
    // Doze exemption. Starts optimistic so the step never flashes as failing
    // before the first check resolves.
    const [dozeExempt, setDozeExempt] = useState(true);
    const [visible, setVisible] = useState(false);
    const [busy, setBusy] = useState(false);

    // Held in a ref so `evaluate` keeps a stable identity: the caller's callback
    // changes whenever the active job does, and re-running the check on every
    // job refresh would pop the prompt back up mid-task after a "Later".
    const onGrantedRef = useRef(onGranted);
    onGrantedRef.current = onGranted;

    const evaluate = useCallback(async () => {
        const [next, exempt] = await Promise.all([
            checkLocationPermissions(),
            isBatteryOptimizationExempt(),
        ]);
        setState(next);
        setDozeExempt(exempt);

        // Location permission is what tracking needs to start at all, so release
        // the caller as soon as it lands — the Doze step can still be outstanding.
        if (next === 'granted') onGrantedRef.current?.();

        // Re-shown deliberately on each mount/resume: dismissing with "Later"
        // must not stick for the shift, or a driver runs the whole day with
        // tracking that dies the moment the phone sleeps.
        setVisible(!(next === 'granted' && exempt));
    }, []);

    // Prompt on mount — i.e. on every arrival at the dashboard after login.
    useEffect(() => { evaluate(); }, [evaluate]);

    useEffect(() => {
        const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
            if (next === 'active') evaluate();
        });
        return () => sub.remove();
    }, [evaluate]);

    const locationOk = state === 'granted';

    const handleEnableLocation = async () => {
        setBusy(true);
        try {
            const next = await requestLocationPermissions();
            setState(next);
            if (next === 'granted') {
                onGrantedRef.current?.();
                if (dozeExempt) setVisible(false);
                return;
            }
            // Foreground-only and blocked both end the same way: Android will not
            // grant "Allow all the time" from a dialog, so hand off to settings.
            await openLocationSettings();
        } finally {
            setBusy(false);
        }
    };

    const handleEnableDoze = async () => {
        setBusy(true);
        try {
            await requestBatteryOptimizationExemption();
            // The system dialog resolves outside our control, so re-read rather
            // than assume — the AppState listener will catch it too.
            const exempt = await isBatteryOptimizationExempt();
            setDozeExempt(exempt);
            if (exempt && locationOk) setVisible(false);
        } finally {
            setBusy(false);
        }
    };

    if (!visible) return null;

    const bodyKey = state === 'foreground-only'
        ? 'permissions.bodyForegroundOnly'
        : 'permissions.body';

    return (
        <Modal visible transparent animationType="fade" onRequestClose={() => setVisible(false)}>
            <View style={st.overlay}>
                <View style={st.card}>
                    <View style={st.iconRing}>
                        <Ionicons name="location" size={26} color="#0A84FF" />
                    </View>

                    <Text style={st.title}>{t('permissions.title')}</Text>
                    <Text style={st.body}>{t(bodyKey)}</Text>

                    {/* Step 1 — location. Without it nothing tracks at all. */}
                    <Step
                        done={locationOk}
                        icon="navigate-outline"
                        label={t('permissions.stepLocation')}
                        detail={t('permissions.stepLocationDetail')}
                    />
                    {!locationOk && (
                        <TouchableOpacity
                            style={[st.primaryBtn, busy && st.btnDisabled]}
                            onPress={handleEnableLocation}
                            disabled={busy}
                        >
                            <Text style={st.primaryLabel}>
                                {state === 'blocked' || state === 'foreground-only'
                                    ? t('permissions.openSettings')
                                    : t('permissions.enable')}
                            </Text>
                        </TouchableOpacity>
                    )}

                    {/* Step 2 — Doze exemption. Location alone survives being
                        backgrounded; only this survives the phone sleeping. */}
                    {Platform.OS === 'android' && (
                        <>
                            <Step
                                done={dozeExempt}
                                icon="battery-charging-outline"
                                label={t('permissions.stepBattery')}
                                detail={t('permissions.stepBatteryDetail')}
                            />
                            {!dozeExempt && (
                                <TouchableOpacity
                                    style={[st.primaryBtn, busy && st.btnDisabled]}
                                    onPress={handleEnableDoze}
                                    disabled={busy}
                                >
                                    <Text style={st.primaryLabel}>{t('permissions.allowBackground')}</Text>
                                </TouchableOpacity>
                            )}
                        </>
                    )}

                    {Platform.OS === 'android' && (
                        <Text style={st.hint}>{t('permissions.androidHint')}</Text>
                    )}

                    <TouchableOpacity style={st.laterBtn} onPress={() => setVisible(false)}>
                        <Text style={st.laterLabel}>{t('permissions.later')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const st = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 24,
        alignItems: 'center',
    },
    iconRing: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#E8F1FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1D1D1F',
        textAlign: 'center',
        marginBottom: 8,
    },
    body: {
        fontSize: 14,
        lineHeight: 20,
        color: '#6E6E73',
        textAlign: 'center',
        marginBottom: 16,
    },
    step: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        width: '100%',
        marginBottom: 10,
    },
    stepText: { flex: 1 },
    stepLabel: { fontSize: 14, fontWeight: '600', color: '#1D1D1F' },
    stepLabelDone: { color: '#34C759' },
    stepDetail: { fontSize: 12, lineHeight: 17, color: '#8A8A8E', marginTop: 2 },
    hint: {
        fontSize: 12,
        lineHeight: 17,
        color: '#8A8A8E',
        textAlign: 'center',
        marginTop: 14,
    },
    primaryBtn: {
        width: '100%',
        backgroundColor: '#0A84FF',
        borderRadius: 12,
        paddingVertical: 13,
        alignItems: 'center',
        marginBottom: 10,
    },
    btnDisabled: { opacity: 0.6 },
    primaryLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
    laterBtn: { marginTop: 6, paddingVertical: 8 },
    laterLabel: { color: '#8A8A8E', fontSize: 14 },
});

export default LocationPermissionGate;
