import React, { useState, useRef, useEffect } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet,
    ActivityIndicator, Animated,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../i18n/i18n';

interface AudioRecorderProps {
    onRecordingComplete: (uri: string, durationSecs: number) => void;
    onCancel?: () => void;
    maxDurationMs?: number;
    title?: string;
    subtitle?: string;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({
    onRecordingComplete,
    onCancel,
    maxDurationMs = 120000,
    title = 'Record Audio',
    subtitle,
}) => {
    const { t } = useTranslation();
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [recordedUri, setRecordedUri] = useState<string | null>(null);
    const [recordedDuration, setRecordedDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isSending, setIsSending] = useState(false);

    const recordingRef = useRef<Audio.Recording | null>(null);
    const soundRef = useRef<Audio.Sound | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        return () => {
            cleanup();
        };
    }, []);

    const cleanup = async () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (soundRef.current) {
            try { await soundRef.current.unloadAsync(); } catch {}
            soundRef.current = null;
        }
        if (recordingRef.current) {
            try { await recordingRef.current.stopAndUnloadAsync(); } catch {}
            recordingRef.current = null;
        }
    };

    useEffect(() => {
        if (isRecording) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
                    Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [isRecording]);

    const startRecording = async () => {
        try {
            // 1. Request permission
            const perm = await Audio.requestPermissionsAsync();
            if (!perm.granted) {
                alert(t('audioRecorder.micPermission'));
                return;
            }

            // 2. Fully clean up any previous recording/sound
            await cleanup();

            // 3. Set audio mode for recording
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            // 4. Use built-in HIGH_QUALITY preset (guaranteed to work on all devices)
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );

            recordingRef.current = recording;
            setIsRecording(true);
            setRecordingDuration(0);
            setRecordedUri(null);

            let elapsed = 0;
            timerRef.current = setInterval(() => {
                elapsed += 1;
                setRecordingDuration(elapsed);
                if (elapsed * 1000 >= maxDurationMs) {
                    stopRecording();
                }
            }, 1000);
        } catch (err) {
            console.error('Failed to start recording:', err);
            // Ensure cleanup if createAsync partially succeeded
            if (recordingRef.current) {
                try { await recordingRef.current.stopAndUnloadAsync(); } catch {}
                recordingRef.current = null;
            }
            alert(t('audioRecorder.couldNotStart'));
        }
    };

    const stopRecording = async () => {
        if (!recordingRef.current) return;
        try {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }

            // Get status BEFORE stopping (duration is cleared after unload)
            const status = await recordingRef.current.getStatusAsync();
            const durationMs = status.durationMillis || recordingDuration * 1000;

            await recordingRef.current.stopAndUnloadAsync();
            const uri = recordingRef.current.getURI();

            await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

            setIsRecording(false);
            setRecordedUri(uri || null);
            setRecordedDuration(Math.max(1, Math.round(durationMs / 1000)));
            recordingRef.current = null;
        } catch (err) {
            console.error('Failed to stop recording:', err);
            setIsRecording(false);
            recordingRef.current = null;
        }
    };

    const playRecording = async () => {
        if (!recordedUri) return;
        try {
            if (soundRef.current) {
                await soundRef.current.unloadAsync();
                soundRef.current = null;
            }

            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            });

            const { sound } = await Audio.Sound.createAsync(
                { uri: recordedUri },
                { shouldPlay: true }
            );
            soundRef.current = sound;
            setIsPlaying(true);

            sound.setOnPlaybackStatusUpdate((status) => {
                if ('didJustFinish' in status && status.didJustFinish) {
                    setIsPlaying(false);
                }
            });
        } catch (err) {
            console.error('Failed to play recording:', err);
            setIsPlaying(false);
        }
    };

    const stopPlaying = async () => {
        if (soundRef.current) {
            await soundRef.current.stopAsync();
            setIsPlaying(false);
        }
    };

    const reRecord = async () => {
        if (soundRef.current) {
            try { await soundRef.current.unloadAsync(); } catch {}
            soundRef.current = null;
        }
        setRecordedUri(null);
        setRecordedDuration(0);
        setRecordingDuration(0);
    };

    const handleSend = async () => {
        if (!recordedUri) return;
        setIsSending(true);
        try {
            await onRecordingComplete(recordedUri, recordedDuration);
        } finally {
            setIsSending(false);
        }
    };

    const formatTime = (secs: number) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{title}</Text>
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

            {!recordedUri && (
                <View style={styles.recordSection}>
                    {isRecording ? (
                        <>
                            <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseAnim }] }]} />
                            <Text style={styles.timer}>{formatTime(recordingDuration)}</Text>
                            <Text style={styles.recordingLabel}>{t('audioRecorder.recording')}</Text>
                            <TouchableOpacity style={styles.stopBtn} onPress={stopRecording}>
                                <Ionicons name="stop" size={28} color="#fff" />
                            </TouchableOpacity>
                            <Text style={styles.hint}>{t('audioRecorder.tapToStop')}</Text>
                        </>
                    ) : (
                        <>
                            <TouchableOpacity style={styles.recordBtn} onPress={startRecording}>
                                <Ionicons name="mic" size={32} color="#fff" />
                            </TouchableOpacity>
                            <Text style={styles.hint}>{t('audioRecorder.tapToRecord')}</Text>
                        </>
                    )}
                </View>
            )}

            {recordedUri && (
                <View style={styles.previewSection}>
                    <View style={styles.waveformBar}>
                        <TouchableOpacity
                            style={styles.playBtn}
                            onPress={isPlaying ? stopPlaying : playRecording}
                        >
                            <Ionicons
                                name={isPlaying ? 'pause' : 'play'}
                                size={22}
                                color="#fff"
                            />
                        </TouchableOpacity>
                        <View style={styles.waveform}>
                            {Array.from({ length: 20 }).map((_, i) => (
                                <View
                                    key={i}
                                    style={[
                                        styles.waveBar,
                                        { height: 6 + Math.random() * 18 },
                                    ]}
                                />
                            ))}
                        </View>
                        <Text style={styles.durationText}>{formatTime(recordedDuration)}</Text>
                    </View>

                    <View style={styles.actionRow}>
                        <TouchableOpacity style={styles.reRecordBtn} onPress={reRecord}>
                            <Ionicons name="refresh" size={18} color="#FF3B30" />
                            <Text style={styles.reRecordText}>{t('audioRecorder.reRecord')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.sendBtn}
                            onPress={handleSend}
                            disabled={isSending}
                        >
                            {isSending ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="send" size={16} color="#fff" />
                                    <Text style={styles.sendText}>{t('audioRecorder.send')}</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {onCancel && (
                <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
                    <Text style={styles.cancelText}>{t('audioRecorder.cancel')}</Text>
                </TouchableOpacity>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 24,
        alignItems: 'center',
    },
    title: {
        fontSize: 18, fontWeight: '700', color: '#1D1D1F',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 13, color: '#86868B', textAlign: 'center',
        marginBottom: 20, lineHeight: 18, paddingHorizontal: 10,
    },
    recordSection: { alignItems: 'center', paddingVertical: 20 },
    recordBtn: {
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center',
        shadowColor: '#FF3B30', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
    },
    stopBtn: {
        width: 64, height: 64, borderRadius: 16,
        backgroundColor: '#1D1D1F', alignItems: 'center', justifyContent: 'center',
        marginTop: 16,
    },
    pulseRing: {
        width: 100, height: 100, borderRadius: 50,
        backgroundColor: 'rgba(255, 59, 48, 0.12)',
        position: 'absolute', top: 10,
    },
    timer: {
        fontSize: 36, fontWeight: '700', color: '#FF3B30',
        marginBottom: 4, fontVariant: ['tabular-nums'],
    },
    recordingLabel: { fontSize: 13, color: '#FF3B30', fontWeight: '500' },
    hint: { fontSize: 12, color: '#AEAEB2', marginTop: 10 },
    previewSection: { width: '100%', paddingVertical: 10 },
    waveformBar: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#F5F5F7', borderRadius: 14, padding: 12,
        gap: 12,
    },
    playBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center',
    },
    waveform: {
        flex: 1, flexDirection: 'row', alignItems: 'center',
        gap: 2, height: 30,
    },
    waveBar: {
        width: 3, backgroundColor: '#007AFF', borderRadius: 2, opacity: 0.6,
    },
    durationText: {
        fontSize: 13, fontWeight: '600', color: '#1D1D1F',
        fontVariant: ['tabular-nums'],
    },
    actionRow: {
        flexDirection: 'row', justifyContent: 'space-between',
        marginTop: 16, gap: 12,
    },
    reRecordBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 12, borderRadius: 10,
        borderWidth: 1, borderColor: '#E5E5EA',
    },
    reRecordText: { fontSize: 14, fontWeight: '600', color: '#FF3B30' },
    sendBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 12, borderRadius: 10,
        backgroundColor: '#1D1D1F',
    },
    sendText: { fontSize: 14, fontWeight: '600', color: '#fff' },
    cancelBtn: { marginTop: 12, paddingVertical: 8 },
    cancelText: { fontSize: 14, color: '#86868B', fontWeight: '500' },
});

export default AudioRecorder;
