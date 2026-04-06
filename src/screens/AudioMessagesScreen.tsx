import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, TouchableOpacity, ScrollView, StyleSheet,
    StatusBar, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as SecureStore from 'expo-secure-store';
import {
    getConversations, getConversationMessages, getMessagableUsers,
    sendAudioMessage, getAudioStreamUrl,
} from '../services/api';
import AudioRecorder from '../components/AudioRecorder';

// ─── Types ───────────────────────────────────────────────
interface Conversation {
    partner_id: number;
    partner_name: string;
    partner_role: string;
    created_at: string;
    duration_secs: number;
    direction: 'sent' | 'received';
    is_read: boolean;
}

interface Message {
    message_id: number;
    sender_id: number;
    sender_name: string;
    sender_role: string;
    duration_secs: number;
    created_at: string;
    is_read: boolean;
}

interface User {
    user_id: number;
    name: string;
    role: string;
}

type ScreenMode = 'list' | 'chat' | 'contacts';

const AudioMessagesScreen = ({ navigation, route }: any) => {
    const breakdownContext = route?.params?.breakdownContext || false;
    const breakdownJobId = route?.params?.jobId || null;

    const [mode, setMode] = useState<ScreenMode>(breakdownContext ? 'contacts' : 'list');
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [contacts, setContacts] = useState<User[]>([]);
    const [selectedPartner, setSelectedPartner] = useState<{ id: number; name: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [showRecorder, setShowRecorder] = useState(false);
    const [isBreakdownFlow, setIsBreakdownFlow] = useState(breakdownContext);
    const [playingId, setPlayingId] = useState<number | null>(null);
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);

    const soundRef = React.useRef<Audio.Sound | null>(null);

    useEffect(() => {
        (async () => {
            const json = await SecureStore.getItemAsync('user');
            if (json) {
                const u = JSON.parse(json);
                setCurrentUserId(u.user_id);
            }
        })();
        return () => {
            if (soundRef.current) {
                soundRef.current.unloadAsync();
                soundRef.current = null;
            }
        };
    }, []);

    const fetchConversations = useCallback(async () => {
        try {
            const data = await getConversations();
            setConversations(data);
        } catch (err) {
            console.error('Failed to fetch conversations:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        if (breakdownContext) {
            // In breakdown mode, load contacts directly
            (async () => {
                try {
                    const data = await getMessagableUsers();
                    setContacts(data);
                } catch (err) {
                    console.error('Failed to fetch contacts:', err);
                } finally {
                    setLoading(false);
                }
            })();
        } else {
            fetchConversations();
        }
    }, [fetchConversations, breakdownContext]);

    const openChat = async (partnerId: number, partnerName: string) => {
        setSelectedPartner({ id: partnerId, name: partnerName });
        setMode('chat');
        setLoading(true);
        try {
            const data = await getConversationMessages(partnerId);
            setMessages(data);
        } catch (err) {
            console.error('Failed to fetch messages:', err);
        } finally {
            setLoading(false);
        }
    };

    const openContacts = async () => {
        setMode('contacts');
        setLoading(true);
        try {
            const data = await getMessagableUsers();
            setContacts(data);
        } catch (err) {
            console.error('Failed to fetch contacts:', err);
        } finally {
            setLoading(false);
        }
    };

    const goBack = () => {
        if (mode === 'chat' && isBreakdownFlow) {
            // Go back to contacts in breakdown flow
            setMode('contacts');
            setSelectedPartner(null);
            setMessages([]);
            setShowRecorder(false);
        } else if (mode === 'chat' || mode === 'contacts') {
            setMode('list');
            setSelectedPartner(null);
            setMessages([]);
            setShowRecorder(false);
            setIsBreakdownFlow(false);
            fetchConversations();
        } else {
            navigation.goBack();
        }
    };

    const playAudio = async (messageId: number) => {
        try {
            // Stop current sound first
            if (soundRef.current) {
                await soundRef.current.unloadAsync();
                soundRef.current = null;
            }
            // Toggle off
            if (playingId === messageId) {
                setPlayingId(null);
                return;
            }

            const token = await SecureStore.getItemAsync('token');
            const url = getAudioStreamUrl(messageId);

            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            });

            const { sound } = await Audio.Sound.createAsync(
                { uri: url, headers: { Authorization: `Bearer ${token || ''}` } },
                { shouldPlay: true }
            );
            soundRef.current = sound;
            setPlayingId(messageId);

            sound.setOnPlaybackStatusUpdate((status) => {
                if ('didJustFinish' in status && status.didJustFinish) {
                    setPlayingId(null);
                }
            });
        } catch (err) {
            console.error('Playback error:', err);
            Alert.alert('Error', 'Failed to play audio');
            setPlayingId(null);
        }
    };

    const handleSendMessage = async (audioUri: string, durationSecs: number) => {
        if (!selectedPartner) return;
        try {
            await sendAudioMessage(audioUri, selectedPartner.id, durationSecs);
            setShowRecorder(false);
            // Refresh chat
            const data = await getConversationMessages(selectedPartner.id);
            setMessages(data);
        } catch (err: any) {
            const msg = err.response?.data?.error || err.message || 'Failed to send';
            Alert.alert('Error', msg);
        }
    };

    const startChatWith = (user: User) => {
        openChat(user.user_id, user.name);
        // Auto-open recorder in breakdown flow
        if (isBreakdownFlow) {
            setShowRecorder(true);
        }
    };

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        const today = new Date();
        if (d.toDateString() === today.toDateString()) return 'Today';
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return d.toLocaleDateString();
    };

    const roleBadge = (role: string) => {
        const colors: Record<string, string> = { ADMIN: '#FF3B30', MANAGER: '#007AFF', DRIVER: '#16A34A' };
        return (
            <View style={[s.roleBadge, { backgroundColor: (colors[role] || '#86868B') + '18' }]}>
                <Text style={[s.roleText, { color: colors[role] || '#86868B' }]}>{role}</Text>
            </View>
        );
    };

    // ═══════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════
    return (
        <SafeAreaView style={s.container}>
            <StatusBar barStyle="dark-content" />

            {/* Header */}
            <View style={s.header}>
                <TouchableOpacity onPress={goBack} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={20} color="#1D1D1F" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>
                    {mode === 'list' ? 'Messages' : mode === 'contacts' ? 'New Message' : selectedPartner?.name || 'Chat'}
                </Text>
                {mode === 'list' ? (
                    <TouchableOpacity onPress={openContacts} style={s.newBtn}>
                        <Ionicons name="create-outline" size={20} color="#007AFF" />
                    </TouchableOpacity>
                ) : (
                    <View style={{ width: 36 }} />
                )}
            </View>

            {/* Breakdown context banner */}
            {isBreakdownFlow && mode === 'contacts' && (
                <View style={s.breakdownBanner}>
                    <Ionicons name="warning" size={18} color="#FF9500" />
                    <Text style={s.breakdownBannerText}>
                        Select the manager who assigned Job #{breakdownJobId} to record a breakdown explanation.
                    </Text>
                </View>
            )}

            {loading ? (
                <View style={s.center}>
                    <ActivityIndicator size="large" color="#1D1D1F" />
                </View>
            ) : mode === 'list' ? (
                /* ── Conversations List ── */
                <ScrollView
                    style={s.list}
                    contentContainerStyle={s.listPad}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchConversations(); }} />
                    }
                >
                    {conversations.length === 0 ? (
                        <View style={s.empty}>
                            <Ionicons name="chatbubbles-outline" size={48} color="#D2D2D7" />
                            <Text style={s.emptyTitle}>No conversations yet</Text>
                            <Text style={s.emptyBody}>Tap + to start a new message</Text>
                        </View>
                    ) : (
                        conversations.map((conv) => (
                            <TouchableOpacity
                                key={conv.partner_id}
                                style={s.convRow}
                                onPress={() => openChat(conv.partner_id, conv.partner_name)}
                                activeOpacity={0.7}
                            >
                                <View style={s.avatar}>
                                    <Text style={s.avatarText}>
                                        {(conv.partner_name || '?')[0].toUpperCase()}
                                    </Text>
                                </View>
                                <View style={s.convInfo}>
                                    <View style={s.convTop}>
                                        <Text style={s.convName}>{conv.partner_name}</Text>
                                        {roleBadge(conv.partner_role)}
                                    </View>
                                    <View style={s.convBottom}>
                                        <Ionicons
                                            name={conv.direction === 'sent' ? 'arrow-up-outline' : 'arrow-down-outline'}
                                            size={12}
                                            color="#86868B"
                                        />
                                        <Text style={s.convPreview}>
                                            🎙 Audio · {conv.duration_secs ? `${Math.round(conv.duration_secs)}s` : '—'}
                                        </Text>
                                    </View>
                                </View>
                                <Text style={s.convTime}>{formatDate(conv.created_at)}</Text>
                            </TouchableOpacity>
                        ))
                    )}
                </ScrollView>
            ) : mode === 'contacts' ? (
                /* ── Contacts List ── */
                <ScrollView style={s.list} contentContainerStyle={s.listPad}>
                    {contacts.length === 0 ? (
                        <View style={s.empty}>
                            <Text style={s.emptyTitle}>No contacts available</Text>
                        </View>
                    ) : (
                        contacts.map((user) => (
                            <TouchableOpacity
                                key={user.user_id}
                                style={s.convRow}
                                onPress={() => startChatWith(user)}
                                activeOpacity={0.7}
                            >
                                <View style={s.avatar}>
                                    <Text style={s.avatarText}>
                                        {(user.name || '?')[0].toUpperCase()}
                                    </Text>
                                </View>
                                <View style={s.convInfo}>
                                    <Text style={s.convName}>{user.name}</Text>
                                    {roleBadge(user.role)}
                                </View>
                                <Ionicons name="chevron-forward" size={16} color="#AEAEB2" />
                            </TouchableOpacity>
                        ))
                    )}
                </ScrollView>
            ) : (
                /* ── Chat View ── */
                <View style={{ flex: 1 }}>
                    <ScrollView
                        style={s.chatList}
                        contentContainerStyle={s.chatPad}
                    >
                        {messages.length === 0 ? (
                            <View style={s.empty}>
                                <Ionicons name="mic-outline" size={40} color="#D2D2D7" />
                                <Text style={s.emptyTitle}>No messages yet</Text>
                                <Text style={s.emptyBody}>Send a voice message below</Text>
                            </View>
                        ) : (
                            messages.map((msg) => {
                                const isMine = msg.sender_id === currentUserId;
                                const playing = playingId === msg.message_id;
                                return (
                                    <View key={msg.message_id} style={[s.bubble, isMine ? s.bubbleMine : s.bubbleTheirs]}>
                                        <TouchableOpacity
                                            style={[s.audioCard, isMine ? s.audioMine : s.audioTheirs]}
                                            onPress={() => playAudio(msg.message_id)}
                                            activeOpacity={0.7}
                                        >
                                            <View style={[s.playBtn, isMine ? s.playBtnMine : s.playBtnTheirs]}>
                                                <Ionicons
                                                    name={playing ? 'pause' : 'play'}
                                                    size={20}
                                                    color={isMine ? '#1D1D1F' : '#fff'}
                                                />
                                            </View>
                                            <View style={s.audioInfo}>
                                                <View style={s.miniWave}>
                                                    {Array.from({ length: 16 }).map((_, i) => (
                                                        <View
                                                            key={i}
                                                            style={[
                                                                s.miniBar,
                                                                {
                                                                    height: 4 + Math.random() * 14,
                                                                    backgroundColor: isMine ? 'rgba(255,255,255,0.5)' : 'rgba(0,122,255,0.35)',
                                                                },
                                                            ]}
                                                        />
                                                    ))}
                                                </View>
                                                <Text style={[s.audioDur, isMine && { color: 'rgba(255,255,255,0.6)' }]}>
                                                    {msg.duration_secs ? `${Math.round(msg.duration_secs)}s` : '—'}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                        <Text style={[s.msgTime, isMine ? s.msgTimeMine : s.msgTimeTheirs]}>
                                            {formatTime(msg.created_at)}  ·  {formatDate(msg.created_at)}
                                        </Text>
                                    </View>
                                );
                            })
                        )}
                    </ScrollView>

                    {/* Record bar or recorder */}
                    {showRecorder ? (
                        <View style={s.recorderContainer}>
                            <AudioRecorder
                                title="Record Message"
                                onRecordingComplete={handleSendMessage}
                                onCancel={() => setShowRecorder(false)}
                            />
                        </View>
                    ) : (
                        <TouchableOpacity
                            style={s.recordBar}
                            onPress={() => setShowRecorder(true)}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="mic" size={22} color="#fff" />
                            <Text style={s.recordBarText}>Hold or tap to record</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}
        </SafeAreaView>
    );
};

// ═══════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════
const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FFFFFF' },

    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA',
    },
    backBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: '#F5F5F7', alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { fontSize: 17, fontWeight: '700', color: '#1D1D1F' },
    newBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: '#F5F5F7', alignItems: 'center', justifyContent: 'center',
    },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { flex: 1 },
    listPad: { paddingBottom: 30 },

    // Conversation row
    convRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0',
    },
    avatar: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: '#1D1D1F', alignItems: 'center', justifyContent: 'center',
        marginRight: 14,
    },
    avatarText: { fontSize: 18, fontWeight: '700', color: '#fff' },
    convInfo: { flex: 1 },
    convTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    convName: { fontSize: 15, fontWeight: '600', color: '#1D1D1F' },
    convBottom: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    convPreview: { fontSize: 13, color: '#86868B' },
    convTime: { fontSize: 12, color: '#AEAEB2', fontWeight: '500' },

    roleBadge: {
        paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    },
    roleText: { fontSize: 10, fontWeight: '700' },

    // Chat
    chatList: { flex: 1 },
    chatPad: { padding: 16, paddingBottom: 10 },
    bubble: { marginBottom: 16, maxWidth: '80%' },
    bubbleMine: { alignSelf: 'flex-end' },
    bubbleTheirs: { alignSelf: 'flex-start' },
    audioCard: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingLeft: 10, paddingRight: 16, paddingVertical: 10, borderRadius: 20,
        minWidth: 200,
    },
    audioMine: { backgroundColor: '#1D1D1F' },
    audioTheirs: { backgroundColor: '#F0F0F5' },
    playBtn: {
        width: 36, height: 36, borderRadius: 18,
        alignItems: 'center', justifyContent: 'center',
    },
    playBtnMine: { backgroundColor: 'rgba(255,255,255,0.95)' },
    playBtnTheirs: { backgroundColor: '#007AFF' },
    audioInfo: { flex: 1 },
    miniWave: { flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 22 },
    miniBar: { width: 3, borderRadius: 2 },
    audioDur: { fontSize: 11, color: '#86868B', marginTop: 3, fontWeight: '500' },
    msgTime: { fontSize: 11, marginTop: 4, marginHorizontal: 4, fontWeight: '500' },
    msgTimeMine: { color: '#AEAEB2', textAlign: 'right' },
    msgTimeTheirs: { color: '#AEAEB2', textAlign: 'left' },

    recordBar: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: '#1D1D1F', marginHorizontal: 16, marginBottom: 16,
        paddingVertical: 14, borderRadius: 14,
    },
    recordBarText: { fontSize: 14, fontWeight: '600', color: '#fff' },
    recorderContainer: { paddingHorizontal: 16, paddingBottom: 16 },

    // Breakdown banner
    breakdownBanner: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: '#FFF8EC', marginHorizontal: 16, marginTop: 10,
        paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
        borderWidth: 1, borderColor: '#FFE0A3',
    },
    breakdownBannerText: {
        flex: 1, fontSize: 13, fontWeight: '500', color: '#8B6914', lineHeight: 18,
    },

    // Empty
    empty: { paddingTop: 80, alignItems: 'center', gap: 6 },
    emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1D1D1F' },
    emptyBody: { fontSize: 14, color: '#86868B' },
});

export default AudioMessagesScreen;
