import React, { useState, useRef, useEffect } from 'react';
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
import { Audio } from 'expo-av';
import { updateStopStatus, uploadVoiceNote } from '../services/api';

const REASONS = [
    { id: 'customer_unavailable', icon: 'person-outline' as const, label: 'Customer unavailable' },
    { id: 'wrong_address', icon: 'navigate-outline' as const, label: 'Wrong address' },
    { id: 'vehicle_issue', icon: 'construct-outline' as const, label: 'Vehicle issue' },
    { id: 'traffic_weather', icon: 'rainy-outline' as const, label: 'Traffic / weather delay' },
];

const MAX_DURATION_MS = 30_000; // 30 seconds

const ReasonScreen = ({ navigation, route }: any) => {
    const { stop } = route.params || {};
    const [selected, setSelected] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // ─── Voice recording state ───────────────────────────
    const [recording, setRecording] = useState<Audio.Recording | null>(null);
    const [recordingUri, setRecordingUri] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const soundRef = useRef<Audio.Sound | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const title = stop?.type === 'pickup' ? 'Can\'t Pick Up' : 'Can\'t Drop Off';

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            soundRef.current?.unloadAsync();
        };
    }, []);

    // ─── Recording controls ─────────────────────────────
    const startRecording = async () => {
        try {
            const perm = await Audio.requestPermissionsAsync();
            if (!perm.granted) {
                Alert.alert('Permission needed', 'Microphone access is required to record a voice note.');
                return;
            }

            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            const { recording: rec } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );

            setRecording(rec);
            setIsRecording(true);
            setElapsed(0);
            setRecordingUri(null);

            // Timer for display + auto-stop at 30s
            timerRef.current = setInterval(() => {
                setElapsed(prev => {
                    if (prev >= MAX_DURATION_MS - 1000) {
                        stopRecording();
                        return MAX_DURATION_MS;
                    }
                    return prev + 1000;
                });
            }, 1000);
        } catch (err) {
            console.error('Failed to start recording:', err);
            Alert.alert('Error', 'Could not start recording.');
        }
    };

    const stopRecording = async () => {
        if (timerRef.current) clearInterval(timerRef.current);

        try {
            if (recording) {
                await recording.stopAndUnloadAsync();
                const uri = recording.getURI();
                setRecordingUri(uri);
            }
        } catch (err) {
            console.error('Failed to stop recording:', err);
        }

        setRecording(null);
        setIsRecording(false);
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    };

    const deleteRecording = () => {
        setRecordingUri(null);
        setElapsed(0);
    };

    // ─── Playback ────────────────────────────────────────
    const togglePlayback = async () => {
        if (!recordingUri) return;

        if (isPlaying && soundRef.current) {
            await soundRef.current.stopAsync();
            setIsPlaying(false);
            return;
        }

        try {
            if (soundRef.current) await soundRef.current.unloadAsync();
            const { sound } = await Audio.Sound.createAsync({ uri: recordingUri });
            soundRef.current = sound;
            sound.setOnPlaybackStatusUpdate((status: any) => {
                if (status.didJustFinish) setIsPlaying(false);
            });
            await sound.playAsync();
            setIsPlaying(true);
        } catch (err) {
            console.error('Playback error:', err);
        }
    };

    // ─── Submit ──────────────────────────────────────────
    const submit = async () => {
        if (!selected) {
            Alert.alert('Select a Reason', 'Please select a reason.');
            return;
        }

        setSubmitting(true);
        try {
            // 1. Mark stop as completed with reason
            await updateStopStatus(stop.jobId, stop.index, 'completed', selected);

            // 2. Upload voice note if recorded (optional)
            if (recordingUri) {
                try {
                    await uploadVoiceNote(stop.jobId, stop.index, recordingUri);
                } catch (uploadErr) {
                    console.warn('Voice note upload failed (non-blocking):', uploadErr);
                    // Don't block the submit — reason is already saved
                }
            }

            Alert.alert('Submitted', `Reason recorded for ${stop?.name || 'stop'}.`, [
                { text: 'OK', onPress: () => navigation.goBack() },
            ]);
        } catch (err) {
            Alert.alert('Error', 'Failed to submit reason. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const formatTime = (ms: number) => {
        const secs = Math.floor(ms / 1000);
        return `0:${secs < 10 ? '0' : ''}${secs}`;
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

                {/* ─── Voice Note Section ─────────────────────── */}
                <Text style={[s.sectionLabel, { marginTop: 20 }]}>Voice note (optional)</Text>

                {!recordingUri ? (
                    <View style={s.voiceContainer}>
                        {isRecording ? (
                            <>
                                <View style={s.recordingIndicator}>
                                    <View style={s.redDot} />
                                    <Text style={s.recordingTime}>{formatTime(elapsed)} / 0:30</Text>
                                </View>
                                <TouchableOpacity onPress={stopRecording} style={s.stopBtn}>
                                    <Ionicons name="stop" size={20} color="#fff" />
                                    <Text style={s.stopBtnText}>Stop</Text>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <TouchableOpacity onPress={startRecording} style={s.recordBtn}>
                                <Ionicons name="mic-outline" size={20} color="#DC2626" />
                                <Text style={s.recordBtnText}>Record voice note</Text>
                                <Text style={s.recordHint}>Max 30 sec</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                ) : (
                    <View style={s.voiceContainer}>
                        <View style={s.playbackRow}>
                            <TouchableOpacity onPress={togglePlayback} style={s.playBtn}>
                                <Ionicons
                                    name={isPlaying ? 'stop' : 'play'}
                                    size={18}
                                    color="#fff"
                                />
                            </TouchableOpacity>
                            <View style={s.playbackInfo}>
                                <Text style={s.playbackLabel}>
                                    {isPlaying ? 'Playing…' : 'Voice note recorded'}
                                </Text>
                                <Text style={s.playbackDuration}>{formatTime(elapsed)}</Text>
                            </View>
                            <TouchableOpacity onPress={deleteRecording} style={s.deleteBtn}>
                                <Ionicons name="trash-outline" size={18} color="#DC2626" />
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

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

    // ─── Voice note styles ───────────────────────────────
    voiceContainer: {
        backgroundColor: '#fff', borderRadius: 12, padding: 16,
        borderWidth: 1, borderColor: '#F1F5F9', marginBottom: 8,
    },
    recordBtn: {
        flexDirection: 'row', alignItems: 'center',
    },
    recordBtnText: {
        fontSize: 14, color: '#DC2626', fontWeight: '600', marginLeft: 8, flex: 1,
    },
    recordHint: { fontSize: 11, color: '#94A3B8' },
    recordingIndicator: {
        flexDirection: 'row', alignItems: 'center', marginBottom: 12,
    },
    redDot: {
        width: 10, height: 10, borderRadius: 5,
        backgroundColor: '#DC2626', marginRight: 8,
    },
    recordingTime: { fontSize: 16, fontWeight: '700', color: '#DC2626' },
    stopBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#DC2626', paddingVertical: 10, borderRadius: 10,
    },
    stopBtnText: { color: '#fff', fontWeight: '600', marginLeft: 6 },
    playbackRow: { flexDirection: 'row', alignItems: 'center' },
    playBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center',
    },
    playbackInfo: { flex: 1, marginLeft: 12 },
    playbackLabel: { fontSize: 13, fontWeight: '600', color: '#334155' },
    playbackDuration: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
    deleteBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center',
    },

    submitBtn: {
        backgroundColor: '#1E293B', paddingVertical: 16, borderRadius: 12,
        alignItems: 'center', marginTop: 24,
    },
    submitDisabled: { backgroundColor: '#CBD5E1' },
    submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

export default ReasonScreen;
