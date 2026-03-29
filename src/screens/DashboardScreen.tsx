import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    StatusBar,
    Alert,
    Linking,
    ActivityIndicator,
    RefreshControl,
    LayoutAnimation,
    Platform,
    UIManager,
    Modal,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getDriverJobs, updateStopStatus, reportBreakdown, startTrip, uploadTaskExplanation } from '../services/api';
import AudioRecorder from '../components/AudioRecorder';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ───────────────────────────────────────────────────
type StopStatus = 'pending' | 'completed' | 'delivered' | 'picked_up' | 'skipped';
type JobOverall = 'pending' | 'completed' | 'interrupted';
type TabKey = 'pending' | 'all' | 'interrupted' | 'completed';

interface Stop {
    id: string;
    jobId: string;
    index: string;
    name: string;
    type: 'pickup' | 'drop';
    customer: string;
    weight: number;
    eta: string;
    status: StopStatus;
    reason?: string;
    lat?: number;
    lng?: number;
    locationName?: string;
    address?: string;
    stacking?: number;
    cubicCm?: number;
    priority?: number;
    timeConstraint?: string;
    taskType?: string;
}

interface Job {
    jobId: string;
    vehicleId: string;
    overall: JobOverall;
    started: boolean;
    stops: Stop[];
    completedCount: number;
    totalCount: number;
}

const TABS: { key: TabKey; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'all', label: 'All' },
    { key: 'interrupted', label: 'Interrupted' },
    { key: 'completed', label: 'Completed' },
];

// ─── Parse Backend Jobs → Job[] ──────────────────────────────
// Backend getDriverJobs returns buildRouteResponse format:
// { job_id, vehicle_id, route_order: [ { task_id, customer_id, location, location_name, task, weight, ... } ], status, ... }

const parseJobs = (rawJobs: any[]): Job[] => {
    return rawJobs.map(job => {
        const statusObj = job.status || {};
        const stopsStatusMap = statusObj.stops || {};
        const jobOverall = (statusObj.overall || 'pending') as JobOverall;

        // route_order is an array of task objects from buildRouteResponse
        const routeOrder: any[] = job.route_order || [];

        const stops: Stop[] = routeOrder.map((task: any, orderIndex: number) => {
            const taskId = String(task.task_id);

            // Stop status from status.stops map
            const stopStatusStr = (typeof stopsStatusMap[taskId] === 'string')
                ? stopsStatusMap[taskId]
                : stopsStatusMap[taskId]?.state || 'pending';

            // Use the "task" field from backend to determine type (pickup/drop)
            const taskType = (task.task || '').toLowerCase();
            const isPickup = taskType === 'pickup';
            const type: 'pickup' | 'drop' = isPickup ? 'pickup' : 'drop';

            const lat = task.location?.lat ?? undefined;
            const lng = task.location?.lng ?? undefined;
            const customer = task.customer_id || '';
            const locationName = task.location_name || customer;
            const name = locationName || String(customer) || (lat && lng ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : `Stop ${taskId}`);
            const weight = task.weight || 0;

            // ETA — prefer dynamicEta, fallback to scheduledTime
            const eta = task.dynamicEta || task.scheduledTime || '';

            let normalizedStatus: StopStatus = 'pending';
            if (stopStatusStr === 'completed') {
                normalizedStatus = isPickup ? 'picked_up' : 'delivered';
            } else if (jobOverall === 'interrupted' && stopStatusStr !== 'completed') {
                normalizedStatus = 'skipped';
            }

            return {
                id: `${job.job_id}-${taskId}`,
                jobId: String(job.job_id),
                index: String(taskId),
                name, type,
                customer: String(customer),
                weight: Number(weight),
                eta: eta ? String(eta) : '',
                status: normalizedStatus,
                reason: jobOverall === 'interrupted' ? 'Job interrupted' : undefined,
                lat, lng,
                locationName,
                address: '',
                stacking: task.stacking ?? undefined,
                cubicCm: task.cubic_cm ?? undefined,
                priority: task.priority ?? undefined,
                timeConstraint: task.time_limit ? String(task.time_limit) : undefined,
                taskType: task.task ? String(task.task) : undefined,
            };
        });

        // Do NOT re-sort — preserve route_order sequence from backend
        const completedCount = stops.filter(s => s.status === 'delivered' || s.status === 'picked_up').length;

        return {
            jobId: String(job.job_id),
            vehicleId: String(job.vehicle_id || ''),
            overall: jobOverall,
            started: !!(job.actual_start || (statusObj.start_location)),
            stops,
            completedCount,
            totalCount: stops.length,
        };
    });
};

const isDone = (s: StopStatus) => s === 'delivered' || s === 'picked_up' || s === 'skipped';

const jobStatusText = (o: JobOverall) =>
    o === 'completed' ? 'Completed' : o === 'interrupted' ? 'Interrupted' : 'In progress';

// ═══════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════
const DashboardScreen = ({ navigation }: any) => {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loadingJobs, setLoadingJobs] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<TabKey>('pending');
    const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [breakdownJobId, setBreakdownJobId] = useState<string | null>(null);
    const [startingJobId, setStartingJobId] = useState<string | null>(null);
    const [userName, setUserName] = useState('Driver');
    const [audioModalStop, setAudioModalStop] = useState<Stop | null>(null);
    const [pendingLocation, setPendingLocation] = useState<{ lat: number; lng: number } | null>(null);

    const scrollRef = useRef<ScrollView>(null);

    useEffect(() => {
        (async () => {
            const json = await SecureStore.getItemAsync('user');
            if (json) {
                const u = JSON.parse(json);
                setUserName(u.username || u.name || 'Driver');
            }
        })();
    }, []);

    const fetchJobs = useCallback(async () => {
        try {
            const raw = await getDriverJobs();
            const parsed = parseJobs(raw);
            setJobs(parsed);
        } catch (err: any) {
            console.error('Failed to fetch jobs:', err);
            if (err?.response?.status === 401) {
                await SecureStore.deleteItemAsync('token');
                await SecureStore.deleteItemAsync('user');
                navigation.replace('Login');
            }
        } finally {
            setLoadingJobs(false);
            setRefreshing(false);
        }
    }, [navigation]);

    useEffect(() => { fetchJobs(); }, [fetchJobs]);
    useEffect(() => {
        const unsub = navigation.addListener('focus', () => {
            if (!loadingJobs) fetchJobs();
        });
        return unsub;
    }, [navigation, fetchJobs, loadingJobs]);

    const onRefresh = () => { setRefreshing(true); fetchJobs(); };

    const filterJobs = (tab: TabKey): Job[] => {
        switch (tab) {
            case 'pending': return jobs.filter(j => j.overall === 'pending');
            case 'completed': return jobs.filter(j => j.overall === 'completed');
            case 'interrupted': return jobs.filter(j => j.overall === 'interrupted');
            case 'all': return jobs;
        }
    };

    const toggleExpand = (jobId: string) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpandedJobId(prev => prev === jobId ? null : jobId);
    };

    // ─── Late threshold: 15 minutes ───────────────────────
    const LATE_THRESHOLD_MS = 15 * 60 * 1000;

    const isTaskLate = (stop: Stop): boolean => {
        if (!stop.eta) return false;
        try {
            const eta = new Date(stop.eta);
            if (isNaN(eta.getTime())) return false;
            return Date.now() > (eta.getTime() + LATE_THRESHOLD_MS);
        } catch {
            return false;
        }
    };

    const finalizeCompletion = async (stop: Stop, lat: number, lng: number) => {
        await updateStopStatus(stop.jobId, stop.index, 'completed', undefined, lat, lng);
        const displayStatus: StopStatus = stop.type === 'pickup' ? 'picked_up' : 'delivered';
        setJobs(prev => prev.map(j => {
            if (j.jobId !== stop.jobId) return j;
            const updatedStops = j.stops.map(s =>
                s.id === stop.id ? { ...s, status: displayStatus } : s
            );
            const newCompleted = updatedStops.filter(s => s.status === 'delivered' || s.status === 'picked_up').length;
            const allDone = newCompleted === j.totalCount;
            return {
                ...j, stops: updatedStops, completedCount: newCompleted,
                overall: allDone ? 'completed' as JobOverall : j.overall,
            };
        }));
    };

    const handleComplete = async (stop: Stop) => {
        setUpdatingId(stop.id);
        try {
            const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
            if (locStatus !== 'granted') {
                Alert.alert('Location Required', 'Please allow location access to complete a task.');
                setUpdatingId(null);
                return;
            }
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            const { latitude, longitude } = loc.coords;

            // Check distance (200m)
            if (stop.lat && stop.lng) {
                const R = 6371e3; // metres
                const rad = Math.PI / 180;
                const dLat = (stop.lat - latitude) * rad;
                const dLon = (stop.lng - longitude) * rad;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                          Math.cos(latitude * rad) * Math.cos(stop.lat * rad) *
                          Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

                if (distance > 200) {
                    Alert.alert(
                        'Too Far From Location',
                        `You must be within 200m of the stop to mark it as completed.\nCurrently: ${Math.round(distance)}m away.`
                    );
                    setUpdatingId(null);
                    return;
                }
            }

            // Check if task is significantly late → require audio explanation
            if (isTaskLate(stop)) {
                setPendingLocation({ lat: latitude, lng: longitude });
                setAudioModalStop(stop);
                // Don't finalize yet — wait for audio recording
                return;
            }

            await finalizeCompletion(stop, latitude, longitude);
        } catch (error: any) {
            const msg = error.response?.data?.error || error.message || 'Failed to complete stop.';
            Alert.alert('Error', msg);
        } finally {
            setUpdatingId(null);
        }
    };

    const handleLateAudioComplete = async (audioUri: string, durationSecs: number) => {
        if (!audioModalStop || !pendingLocation) return;
        try {
            // 1. Upload the audio explanation
            await uploadTaskExplanation(audioUri, audioModalStop.jobId, audioModalStop.index, durationSecs);

            // 2. Finalize the task completion
            await finalizeCompletion(audioModalStop, pendingLocation.lat, pendingLocation.lng);

            setAudioModalStop(null);
            setPendingLocation(null);
            Alert.alert('Done', 'Task completed and audio explanation recorded.');
        } catch (error: any) {
            const msg = error.response?.data?.error || error.message || 'Failed to submit.';
            Alert.alert('Error', msg);
        } finally {
            setUpdatingId(null);
        }
    };

    const openNavigation = (stop: Stop) => {
        if (!stop.lat || !stop.lng) {
            Alert.alert('No Location', 'Coordinates not available for this stop.');
            return;
        }
        Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`);
    };

    const openJobRoute = async (job: Job) => {
        const pendingStops = job.stops.filter(s => !isDone(s.status) && s.lat && s.lng);
        if (pendingStops.length === 0) {
            Alert.alert('No Stops', 'No pending stops with coordinates available.');
            return;
        }

        let originParam = '';
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                originParam = `&origin=${loc.coords.latitude},${loc.coords.longitude}`;
            }
        } catch { /* fall back — Google Maps will use device location */ }

        const destination = pendingStops[pendingStops.length - 1];
        const waypoints = pendingStops.slice(0, -1);
        const waypointParam = waypoints.length > 0
            ? `&waypoints=${waypoints.map(s => `${s.lat},${s.lng}`).join('|')}`
            : '';

        Linking.openURL(
            `https://www.google.com/maps/dir/?api=1${originParam}&destination=${destination.lat},${destination.lng}${waypointParam}&travelmode=driving`
        );
    };

    const handleSkip = (stop: Stop) => navigation.navigate('Reason', { stop });

    const handleStartTrip = async (job: Job) => {
        setStartingJobId(job.jobId);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Location Required', 'Please allow location access to start the trip.');
                setStartingJobId(null);
                return;
            }
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            await startTrip(job.jobId, loc.coords.latitude, loc.coords.longitude);
            setJobs(prev => prev.map(j =>
                j.jobId === job.jobId ? { ...j, started: true } : j
            ));
            Alert.alert('Trip Started', 'Your delivery has started. ETA has been updated.');
        } catch (error: any) {
            const msg = error.response?.data?.error || error.message || 'Failed to start trip. Try again.';
            Alert.alert('Error', msg);
        } finally {
            setStartingJobId(null);
        }
    };

    const handleBreakdown = (job: Job) => {
        Alert.alert(
            'Vehicle Breakdown',
            `Report a vehicle breakdown for Job #${job.jobId}?\n\nThis will interrupt the job and notify all managers via email.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Report Breakdown',
                    style: 'destructive',
                    onPress: async () => {
                        setBreakdownJobId(job.jobId);
                        try {
                            const { status } = await Location.requestForegroundPermissionsAsync();
                            let lat = 0, lng = 0;
                            if (status === 'granted') {
                                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                                lat = loc.coords.latitude;
                                lng = loc.coords.longitude;
                            }
                            await reportBreakdown(job.vehicleId, job.jobId, lat, lng);
                            setJobs(prev => prev.map(j =>
                                j.jobId === job.jobId
                                    ? { ...j, overall: 'interrupted' as JobOverall }
                                    : j
                            ));
                            Alert.alert('Reported', 'Managers have been notified via email.');
                        } catch (error: any) {
                            const msg = error.response?.data?.error || error.message || 'Failed to report breakdown.';
                            Alert.alert('Error', msg);
                        } finally {
                            setBreakdownJobId(null);
                        }
                    },
                },
            ]
        );
    };

    const handleLogout = async () => {
        Alert.alert('Logout', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Logout', style: 'destructive',
                onPress: async () => {
                    await SecureStore.deleteItemAsync('token');
                    await SecureStore.deleteItemAsync('user');
                    navigation.replace('Login');
                },
            },
        ]);
    };

    const filtered = filterJobs(activeTab);
    const pendingJobs = jobs.filter(j => j.overall === 'pending');
    const totalStops = pendingJobs.reduce((sum, j) => sum + j.totalCount, 0);
    const totalCompleted = pendingJobs.reduce((sum, j) => sum + j.completedCount, 0);
    const progress = totalStops > 0 ? totalCompleted / totalStops : 0;

    // ─── Stop card ────────────────────────────────────
    const renderStop = (stop: Stop) => {
        const done = isDone(stop.status);
        const loading = updatingId === stop.id;

        return (
            <View key={stop.id} style={[st.stopCard, done && st.stopDone]}>
                <View style={st.stopTop}>
                    <View style={st.stopInfo}>
                        <Ionicons
                            name={stop.type === 'pickup' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                            size={18}
                            color={done ? '#AEAEB2' : '#1D1D1F'}
                        />
                        <View style={{ flex: 1 }}>
                            <Text style={[st.stopLabel, done && st.stopLabelDone]}>
                                {stop.type === 'pickup' ? 'Pickup' : 'Drop-off'}
                            </Text>
                            <TouchableOpacity onPress={() => navigation.navigate('TaskDetail', { stop })} activeOpacity={0.6}>
                                <Text style={[st.stopName, done && st.stopNameDone, !done && st.stopNameLink]} numberOfLines={1}>
                                    {stop.name}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    {done && <Ionicons name="checkmark-circle" size={22} color="#AEAEB2" />}
                </View>

                {stop.weight > 0 && (
                    <Text style={st.stopMeta}>{stop.weight} kg</Text>
                )}

                {stop.reason && (
                    <Text style={st.stopReason}>{stop.reason}</Text>
                )}

                {!done && (
                    <View style={st.btnRow}>
                        <TouchableOpacity style={st.btnDone} onPress={() => handleComplete(stop)} disabled={loading}>
                            {loading
                                ? <ActivityIndicator size="small" color="#fff" />
                                : <><Ionicons name="checkmark" size={16} color="#fff" /><Text style={st.btnDoneText}>Done</Text></>
                            }
                        </TouchableOpacity>
                        <TouchableOpacity style={st.btnOutline} onPress={() => openNavigation(stop)}>
                            <Ionicons name="navigate-outline" size={15} color="#1D1D1F" />
                            <Text style={st.btnOutlineText}>Map</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={st.btnOutline} onPress={() => handleSkip(stop)}>
                            <Ionicons name="flag-outline" size={15} color="#1D1D1F" />
                            <Text style={st.btnOutlineText}>Reason</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        );
    };

    // ─── Job card ─────────────────────────────────────
    const renderJob = (job: Job) => {
        const expanded = expandedJobId === job.jobId;
        const pct = job.totalCount > 0 ? Math.round((job.completedCount / job.totalCount) * 100) : 0;

        return (
            <View key={job.jobId} style={st.jobCard}>
                <TouchableOpacity activeOpacity={0.7} onPress={() => toggleExpand(job.jobId)} style={st.jobRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={st.jobTitle}>Job #{job.jobId}</Text>
                        <Text style={st.jobSub}>
                            {jobStatusText(job.overall)}  ·  {job.completedCount}/{job.totalCount} stops  ·  {pct}%
                        </Text>
                    </View>
                    {job.overall === 'pending' && !job.started && (
                        <TouchableOpacity
                            style={st.startBtn}
                            onPress={() => handleStartTrip(job)}
                            activeOpacity={0.7}
                            disabled={startingJobId === job.jobId}
                        >
                            {startingJobId === job.jobId ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="play" size={14} color="#fff" />
                                    <Text style={st.startBtnText}>Start</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    )}
                    {job.overall === 'pending' && (
                        <TouchableOpacity style={st.jobMapBtn} onPress={() => openJobRoute(job)} activeOpacity={0.7}>
                            <Ionicons name="map-outline" size={16} color="#fff" />
                            <Text style={st.jobMapBtnText}>Route</Text>
                        </TouchableOpacity>
                    )}
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color="#AEAEB2" />
                </TouchableOpacity>

                {/* Progress bar */}
                <View style={st.barTrack}>
                    <View style={[st.barFill, { width: `${pct}%` }]} />
                </View>

                {expanded && (
                    <View style={st.expandedArea}>
                        {/* Breakdown — job level */}
                        {job.overall === 'pending' && (
                            <TouchableOpacity
                                style={st.breakdownRow}
                                onPress={() => handleBreakdown(job)}
                                disabled={breakdownJobId === job.jobId}
                            >
                                {breakdownJobId === job.jobId ? (
                                    <ActivityIndicator size="small" color="#FF3B30" />
                                ) : (
                                    <>
                                        <Ionicons name="warning-outline" size={18} color="#FF3B30" />
                                        <Text style={st.breakdownLabel}>Report Vehicle Breakdown</Text>
                                        <Ionicons name="chevron-forward" size={16} color="#AEAEB2" />
                                    </>
                                )}
                            </TouchableOpacity>
                        )}

                        {job.stops.map(renderStop)}
                    </View>
                )}
            </View>
        );
    };

    // ═══════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════
    return (
        <SafeAreaView style={st.container}>
            <StatusBar barStyle="dark-content" />

            {/* Late Task Audio Modal */}
            <Modal
                visible={!!audioModalStop}
                transparent
                animationType="slide"
                onRequestClose={() => {
                    setAudioModalStop(null);
                    setPendingLocation(null);
                    setUpdatingId(null);
                }}
            >
                <View style={st.modalOverlay}>
                    <View style={st.modalContent}>
                        <AudioRecorder
                            title="Late Task — Explanation Required"
                            subtitle={`You are completing task #${audioModalStop?.index} later than scheduled. Please record a brief audio explanation.`}
                            onRecordingComplete={handleLateAudioComplete}
                            onCancel={() => {
                                setAudioModalStop(null);
                                setPendingLocation(null);
                                setUpdatingId(null);
                            }}
                        />
                    </View>
                </View>
            </Modal>

            {/* Header */}
            <View style={st.header}>
                <View>
                    <Text style={st.hi}>Hello,</Text>
                    <Text style={st.name}>{userName}</Text>
                </View>
                <View style={st.headerRight}>
                    <TouchableOpacity
                        onPress={() => navigation.navigate('AudioMessages')}
                        style={st.msgBtn}
                    >
                        <Ionicons name="chatbubble-ellipses-outline" size={20} color="#1D1D1F" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleLogout} style={st.logoutBtn}>
                        <Ionicons name="log-out-outline" size={20} color="#1D1D1F" />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Progress summary — separate card */}
            <View style={st.progressBox}>
                <View style={st.summaryCard}>
                    <View style={st.summaryLeft}>
                        <Text style={st.summaryTitle}>Pending Job Progress</Text>
                        <Text style={st.summaryCount}>
                            {totalCompleted}<Text style={st.summaryOf}> / {totalStops} stops</Text>
                        </Text>
                    </View>
                    <Text style={st.summaryPct}>{Math.round(progress * 100)}%</Text>
                </View>
                <View style={st.summaryBarTrack}>
                    <View style={[st.summaryBarFill, { width: `${progress * 100}%` }]} />
                </View>
            </View>

            {/* Tabs */}
            <View style={st.tabBar}>
                {TABS.map(tab => {
                    const active = activeTab === tab.key;
                    const count = filterJobs(tab.key).length;
                    return (
                        <TouchableOpacity
                            key={tab.key}
                            onPress={() => { setActiveTab(tab.key); setExpandedJobId(null); }}
                            style={[st.tab, active && st.tabActive]}
                        >
                            <Text style={[st.tabText, active && st.tabTextActive]}>
                                {tab.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>

            {/* Job list */}
            {loadingJobs ? (
                <View style={st.center}>
                    <ActivityIndicator size="large" color="#1D1D1F" />
                </View>
            ) : (
                <ScrollView
                    ref={scrollRef}
                    style={st.list}
                    contentContainerStyle={st.listPad}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1D1D1F" />}
                >
                    {filtered.length === 0 ? (
                        <View style={st.empty}>
                            <Ionicons name="cube-outline" size={40} color="#D2D2D7" />
                            <Text style={st.emptyTitle}>No jobs here</Text>
                            <Text style={st.emptyBody}>Pull down to refresh.</Text>
                        </View>
                    ) : (
                        filtered.map(renderJob)
                    )}
                </ScrollView>
            )}
        </SafeAreaView>
    );
};

// ═══════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════
const st = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FFFFFF' },

    // Modal
    modalOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingBottom: 40,
    },

    // Header
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4,
    },
    headerRight: { flexDirection: 'row', gap: 8 },
    hi: { fontSize: 14, color: '#86868B' },
    name: { fontSize: 26, fontWeight: '700', color: '#1D1D1F', marginTop: 2 },
    msgBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: '#F5F5F7', alignItems: 'center', justifyContent: 'center',
    },
    logoutBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: '#F5F5F7', alignItems: 'center', justifyContent: 'center',
    },

    // Summary card
    progressBox: {
        marginHorizontal: 20, marginTop: 14, marginBottom: 18,
        backgroundColor: '#E5E5EA', borderRadius: 14, padding: 18,
        borderWidth: 1, borderColor: '#EFEFEF',
    },
    summaryCard: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
        marginBottom: 14,
    },
    summaryLeft: {},
    summaryTitle: { fontSize: 12, color: '#86868B', fontWeight: '500', marginBottom: 4 },
    summaryCount: { fontSize: 22, fontWeight: '700', color: '#1D1D1F' },
    summaryOf: { fontWeight: '400', color: '#86868B' },
    summaryPct: { fontSize: 32, fontWeight: '700', color: '#1D1D1F' },
    summaryBarTrack: { height: 4, backgroundColor: '#E5E5EA', borderRadius: 2 },
    summaryBarFill: { height: 4, backgroundColor: '#1D1D1F', borderRadius: 2 },

    // Tabs
    tabBar: {
        flexDirection: 'row', paddingHorizontal: 20,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA',
    },
    tab: {
        paddingBottom: 10, marginRight: 20,
        borderBottomWidth: 2, borderBottomColor: 'transparent',
    },
    tabActive: { borderBottomColor: '#1D1D1F' },
    tabText: { fontSize: 14, fontWeight: '500', color: '#AEAEB2' },
    tabTextActive: { color: '#1D1D1F', fontWeight: '600' },

    // Job card
    jobCard: {
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0',
    },
    jobRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingVertical: 16,
    },
    jobTitle: { fontSize: 16, fontWeight: '600', color: '#1D1D1F' },
    jobSub: { fontSize: 13, color: '#86868B', marginTop: 2 },
    jobMapBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#007AFF', paddingHorizontal: 10, paddingVertical: 6,
        borderRadius: 8, marginRight: 10,
    },
    jobMapBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    startBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#16A34A', paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: 8, marginRight: 8,
    },
    startBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    barTrack: { height: 2, backgroundColor: '#F5F5F7', marginHorizontal: 20 },
    barFill: { height: 2, backgroundColor: '#1D1D1F' },

    // Expanded area
    expandedArea: { paddingBottom: 8 },

    // Breakdown (job-level)
    breakdownRow: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        marginHorizontal: 20, marginTop: 12, marginBottom: 4,
        paddingVertical: 12, paddingHorizontal: 16,
        borderRadius: 10, borderWidth: 1, borderColor: '#E5E5EA',
    },
    breakdownLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: '#FF3B30' },

    // Stop card
    stopCard: {
        marginHorizontal: 20, marginTop: 10, padding: 14,
        borderRadius: 10, backgroundColor: '#F9F9F9',
    },
    stopDone: { opacity: 0.5 },
    stopTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    stopInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    stopLabel: { fontSize: 11, color: '#86868B', fontWeight: '500' },
    stopLabelDone: { color: '#AEAEB2' },
    stopName: { fontSize: 15, fontWeight: '600', color: '#1D1D1F' },
    stopNameDone: { color: '#AEAEB2' },
    stopNameLink: { color: '#007AFF', textDecorationLine: 'underline' },
    stopMeta: { fontSize: 12, color: '#86868B', marginTop: 6, paddingLeft: 28 },
    stopReason: { fontSize: 12, color: '#FF3B30', marginTop: 4, paddingLeft: 28 },

    // Buttons
    btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
    btnDone: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
        backgroundColor: '#1D1D1F', paddingVertical: 10, borderRadius: 8,
    },
    btnDoneText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    btnOutline: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8,
        borderWidth: 1, borderColor: '#E5E5EA',
    },
    btnOutlineText: { fontSize: 12, fontWeight: '500', color: '#1D1D1F' },

    // Loading & empty
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { flex: 1 },
    listPad: { paddingBottom: 40 },
    empty: { paddingTop: 80, alignItems: 'center', gap: 6 },
    emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1D1D1F' },
    emptyBody: { fontSize: 14, color: '#86868B' },
});

export default DashboardScreen;
