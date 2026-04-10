import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    StatusBar,
    Alert,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { updateStopStatus } from '../services/api';
import { useTranslation } from '../i18n/i18n';

const REASON_KEYS = [
    { id: 'customer_unavailable', icon: 'person-outline' as const, labelKey: 'reason.customerUnavailable' },
    { id: 'wrong_address', icon: 'navigate-outline' as const, labelKey: 'reason.wrongAddress' },
    { id: 'vehicle_issue', icon: 'construct-outline' as const, labelKey: 'reason.vehicleIssue' },
    { id: 'traffic_weather', icon: 'rainy-outline' as const, labelKey: 'reason.trafficWeather' },
];

const ReasonScreen = ({ navigation, route }: any) => {
    const { t } = useTranslation();
    const { stop } = route.params || {};
    const [selected, setSelected] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const title = stop?.type === 'pickup' ? t('reason.cantPickUp') : t('reason.cantDropOff');

    const submit = async () => {
        if (!selected) {
            Alert.alert(t('reason.selectReason'), t('reason.selectReasonMsg'));
            return;
        }

        setSubmitting(true);
        try {
            // Capture driver's current location for proximity validation
            const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
            if (locStatus !== 'granted') {
                Alert.alert(t('reason.locationRequired'), t('reason.locationRequiredMsg'));
                setSubmitting(false);
                return;
            }
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            const { latitude, longitude } = loc.coords;

            await updateStopStatus(stop.jobId, stop.index, 'completed', selected, latitude, longitude);

            Alert.alert(t('reason.submitted'), t('reason.submittedMsg', { name: stop?.name || 'stop' }), [
                { text: t('common.ok'), onPress: () => navigation.goBack() },
            ]);
        } catch (err) {
            Alert.alert(t('common.error'), t('reason.errorSubmit'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <SafeAreaView style={s.container}>
            <StatusBar barStyle="dark-content" />

            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={20} color="#1E293B" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>{title}</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={s.stopInfo}>
                    <Text style={s.stopLabel}>{t('reason.stop')} #{stop?.index || '?'}</Text>
                    <Text style={s.stopName}>{stop?.name || t('reason.unknown')}</Text>
                    <Text style={[
                        s.stopType,
                        stop?.type === 'pickup' ? { color: '#16A34A' } : { color: '#EA580C' },
                    ]}>
                        {stop?.type === 'pickup' ? t('reason.pickupArrow') : t('reason.dropOffArrow')}
                    </Text>
                </View>

                <Text style={s.sectionLabel}>{t('reason.whatHappened')}</Text>
                {REASON_KEYS.map((r) => {
                    const active = selected === r.id;
                    return (
                        <TouchableOpacity
                            key={r.id}
                            activeOpacity={0.6}
                            onPress={() => setSelected(active ? null : r.id)}
                            style={[s.reasonRow, active && s.reasonRowActive]}
                        >
                            <View style={[s.reasonIcon, active && s.reasonIconActive]}>
                                <Ionicons name={r.icon} size={18} color={active ? '#fff' : '#64748B'} />
                            </View>
                            <Text style={[s.reasonText, active && s.reasonTextActive]}>{t(r.labelKey)}</Text>
                            <View style={[s.radio, active && s.radioActive]}>
                                {active && <View style={s.radioDot} />}
                            </View>
                        </TouchableOpacity>
                    );
                })}

                <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={submit}
                    disabled={!selected || submitting}
                    style={[s.submitBtn, (!selected) && s.submitDisabled]}
                >
                    {submitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                    ) : (
                        <Text style={s.submitText}>{t('reason.submit')}</Text>
                    )}
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
};

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FAFBFC' },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 10,
    },
    backBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B' },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
    stopInfo: {
        backgroundColor: '#fff', borderRadius: 12, padding: 16,
        borderWidth: 1, borderColor: '#F1F5F9', marginBottom: 20,
    },
    stopLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '600', letterSpacing: 0.5 },
    stopName: { fontSize: 17, fontWeight: '700', color: '#1E293B', marginTop: 4 },
    stopType: { fontSize: 12, fontWeight: '600', marginTop: 4 },
    sectionLabel: { fontSize: 13, fontWeight: '600', color: '#64748B', marginBottom: 10 },
    reasonRow: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#fff', padding: 14, borderRadius: 12,
        borderWidth: 1, borderColor: '#F1F5F9', marginBottom: 8,
    },
    reasonRowActive: { borderColor: '#1E293B', backgroundColor: '#F8FAFC' },
    reasonIcon: {
        width: 36, height: 36, borderRadius: 10,
        backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center',
        marginRight: 12,
    },
    reasonIconActive: { backgroundColor: '#1E293B' },
    reasonText: { flex: 1, fontSize: 14, color: '#334155', fontWeight: '500' },
    reasonTextActive: { color: '#1E293B', fontWeight: '600' },
    radio: {
        width: 20, height: 20, borderRadius: 10,
        borderWidth: 1.5, borderColor: '#CBD5E1',
        alignItems: 'center', justifyContent: 'center', marginLeft: 8,
    },
    radioActive: { borderColor: '#1E293B' },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1E293B' },

    submitBtn: {
        backgroundColor: '#1E293B', paddingVertical: 16, borderRadius: 12,
        alignItems: 'center', marginTop: 24,
    },
    submitDisabled: { backgroundColor: '#CBD5E1' },
    submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

export default ReasonScreen;
