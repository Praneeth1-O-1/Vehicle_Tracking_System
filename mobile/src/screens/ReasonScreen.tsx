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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { updateStopStatus } from '../services/api';

const REASONS = [
    { id: 'customer_unavailable', icon: 'person-outline' as const, label: 'Customer unavailable' },
    { id: 'wrong_address', icon: 'navigate-outline' as const, label: 'Wrong address' },
    { id: 'vehicle_issue', icon: 'construct-outline' as const, label: 'Vehicle issue' },
    { id: 'traffic_weather', icon: 'rainy-outline' as const, label: 'Traffic / weather delay' },
];

const ReasonScreen = ({ navigation, route }: any) => {
    const { stop } = route.params || {};
    const [selected, setSelected] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const title = stop?.type === 'pickup' ? 'Can\'t Pick Up' : 'Can\'t Drop Off';

    const submit = async () => {
        if (!selected) {
            Alert.alert('Select a Reason', 'Please select a reason.');
            return;
        }

        setSubmitting(true);
        try {
            await updateStopStatus(stop.jobId, stop.index, 'completed', selected);

            Alert.alert('Submitted', `Reason recorded for ${stop?.name || 'stop'}.`, [
                { text: 'OK', onPress: () => navigation.goBack() },
            ]);
        } catch (err) {
            Alert.alert('Error', 'Failed to submit reason. Please try again.');
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
                    <Text style={s.stopLabel}>Stop #{stop?.index || '?'}</Text>
                    <Text style={s.stopName}>{stop?.name || 'Unknown'}</Text>
                    <Text style={[
                        s.stopType,
                        stop?.type === 'pickup' ? { color: '#16A34A' } : { color: '#EA580C' },
                    ]}>
                        {stop?.type === 'pickup' ? '↑ Pickup' : '↓ Drop-off'}
                    </Text>
                </View>

                <Text style={s.sectionLabel}>What happened?</Text>
                {REASONS.map((r) => {
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
                            <Text style={[s.reasonText, active && s.reasonTextActive]}>{r.label}</Text>
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
                        <Text style={s.submitText}>Submit</Text>
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
