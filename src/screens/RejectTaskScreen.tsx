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
    TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { rejectTask, uploadTaskExplanation } from '../services/api';
import AudioRecorder from '../components/AudioRecorder';

const REJECTION_REASONS = [
    { id: 'customer_unavailable', icon: 'person-outline' as const, label: 'Customer unavailable' },
    { id: 'wrong_address', icon: 'navigate-outline' as const, label: 'Wrong / invalid address' },
    { id: 'unsafe_location', icon: 'shield-outline' as const, label: 'Unsafe location' },
    { id: 'access_denied', icon: 'lock-closed-outline' as const, label: 'Access denied' },
    { id: 'damaged_goods', icon: 'cube-outline' as const, label: 'Damaged / missing goods' },
    { id: 'other', icon: 'ellipsis-horizontal-outline' as const, label: 'Other' },
];

const RejectTaskScreen = ({ navigation, route }: any) => {
    const { stop } = route.params || {};
    const [selected, setSelected] = useState<string | null>(null);
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [audioData, setAudioData] = useState<{ uri: string; durationSecs: number } | null>(null);

    const submit = async () => {
        if (!selected) {
            Alert.alert('Select a Reason', 'Please select a reason for rejecting this task.');
            return;
        }

        Alert.alert(
            'Confirm Rejection',
            'This action is permanent and cannot be undone. Are you sure you want to reject this task?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Yes, Reject',
                    style: 'destructive',
                    onPress: async () => {
                        setSubmitting(true);
                        try {
                            let uploadedMessageId: string | undefined;

                            if (audioData) {
                                const res = await uploadTaskExplanation(
                                    audioData.uri,
                                    stop.jobId,
                                    stop.index,
                                    audioData.durationSecs
                                );
                                uploadedMessageId = res?.DATA?.id;
                            }

                            await rejectTask(stop.jobId, stop.index, {
                                predefined_reason: selected || undefined,
                                text: notes.trim() || undefined,
                                audio_message_id: uploadedMessageId,
                            });

                            Alert.alert(
                                'Task Rejected',
                                `Task "${stop?.name || 'Unknown'}" has been permanently rejected.`,
                                [{ text: 'OK', onPress: () => navigation.goBack() }]
                            );
                        } catch (err: any) {
                            const msg = err?.response?.data?.error || err.message || 'Failed to reject task.';
                            Alert.alert('Error', msg);
                        } finally {
                            setSubmitting(false);
                        }
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={s.container}>
            <StatusBar barStyle="dark-content" />

            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={20} color="#1E293B" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Reject Task</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Task info */}
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

                {/* Warning banner */}
                <View style={s.warningBanner}>
                    <Ionicons name="warning-outline" size={16} color="#DC2626" />
                    <Text style={s.warningText}>
                        This rejection is permanent and cannot be reversed.
                    </Text>
                </View>

                <Text style={s.sectionLabel}>Reason for rejection</Text>
                {REJECTION_REASONS.map((r) => {
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

                {/* Optional notes */}
                <Text style={[s.sectionLabel, { marginTop: 16 }]}>Additional notes (optional)</Text>
                <TextInput
                    style={s.notesInput}
                    placeholder="Describe the situation..."
                    placeholderTextColor="#94A3B8"
                    multiline
                    numberOfLines={3}
                    value={notes}
                    onChangeText={setNotes}
                    textAlignVertical="top"
                />

                <Text style={s.sectionLabel}>Voice Note (optional)</Text>
                {audioData ? (
                    <View style={s.audioAttachedBox}>
                        <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
                        <Text style={s.audioAttachedText}>Audio explanation attached ({audioData.durationSecs}s)</Text>
                        <TouchableOpacity onPress={() => setAudioData(null)} style={{ marginLeft: 'auto' }}>
                            <Ionicons name="close-circle" size={20} color="#94A3B8" />
                        </TouchableOpacity>
                    </View>
                ) : (
                    <AudioRecorder
                        onRecordingComplete={(uri, durationSecs) => setAudioData({ uri, durationSecs })}
                        title="Record a reason"
                        subtitle="Explain why this task is being permanently rejected"
                    />
                )}

                <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={submit}
                    disabled={!selected || submitting}
                    style={[s.submitBtn, (!selected) && s.submitDisabled, { marginTop: 16 }]}
                >
                    {submitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                    ) : (
                        <>
                            <Ionicons name="trash-outline" size={16} color="#fff" />
                            <Text style={s.submitText}>  Reject Task</Text>
                        </>
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
    headerTitle: { fontSize: 16, fontWeight: '700', color: '#DC2626' },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
    stopInfo: {
        backgroundColor: '#fff', borderRadius: 12, padding: 16,
        borderWidth: 1, borderColor: '#F1F5F9', marginBottom: 12,
    },
    stopLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '600', letterSpacing: 0.5 },
    stopName: { fontSize: 17, fontWeight: '700', color: '#1E293B', marginTop: 4 },
    stopType: { fontSize: 12, fontWeight: '600', marginTop: 4 },
    warningBanner: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA',
        borderRadius: 10, padding: 12, marginBottom: 16,
    },
    warningText: { flex: 1, fontSize: 12, color: '#DC2626', fontWeight: '500' },
    sectionLabel: { fontSize: 13, fontWeight: '600', color: '#64748B', marginBottom: 10 },
    reasonRow: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#fff', padding: 14, borderRadius: 12,
        borderWidth: 1, borderColor: '#F1F5F9', marginBottom: 8,
    },
    reasonRowActive: { borderColor: '#DC2626', backgroundColor: '#FEF2F2' },
    reasonIcon: {
        width: 36, height: 36, borderRadius: 10,
        backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center',
        marginRight: 12,
    },
    reasonIconActive: { backgroundColor: '#DC2626' },
    reasonText: { flex: 1, fontSize: 14, color: '#334155', fontWeight: '500' },
    reasonTextActive: { color: '#DC2626', fontWeight: '600' },
    radio: {
        width: 20, height: 20, borderRadius: 10,
        borderWidth: 1.5, borderColor: '#CBD5E1',
        alignItems: 'center', justifyContent: 'center', marginLeft: 8,
    },
    radioActive: { borderColor: '#DC2626' },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#DC2626' },
    notesInput: {
        backgroundColor: '#fff', borderRadius: 12, padding: 14,
        borderWidth: 1, borderColor: '#F1F5F9', fontSize: 14,
        color: '#1E293B', minHeight: 80, marginBottom: 8,
    },
    submitBtn: {
        backgroundColor: '#DC2626', paddingVertical: 16, borderRadius: 12,
        alignItems: 'center', justifyContent: 'center', marginTop: 24,
        flexDirection: 'row',
    },
    submitDisabled: { backgroundColor: '#FCA5A5' },
    submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    audioAttachedBox: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0FDF4',
        borderWidth: 1, borderColor: '#BBF7D0', padding: 12, borderRadius: 12,
        marginBottom: 8,
    },
    audioAttachedText: { fontSize: 13, color: '#166534', fontWeight: '600', marginLeft: 8 },
});

export default RejectTaskScreen;
