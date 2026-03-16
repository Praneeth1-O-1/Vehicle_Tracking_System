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
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getDriverJobs, updateStopStatus, reportBreakdown } from '../services/api';

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
    overall: JobOverall;
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
const META_KEYS = new Set(['overall', 'state', 'reason']);

const parseJobs = (rawJobs: any[]): Job[] => {
    return rawJobs.map(job => {
        const statusObj = job.status || {};
        const hasStopsWrapper = statusObj.stops && typeof statusObj.stops === 'object';
        const stopsMap = hasStopsWrapper ? statusObj.stops : statusObj;
        const jobOverall = (statusObj.overall || statusObj.state || 'pending') as JobOverall;

        const pickupLoc = job.pickup_loc || job.pickup_location || {};
        const dropLoc = job.drop_loc || job.drop_location || {};
        const customerIds = job.customer_ids || {};
        const weightObj = job.weight || {};
        const routeOrder = job.routeorder || job.routeOrder || [];

        const taskIds = routeOrder.length > 0
            ? routeOrder
            : Object.keys(stopsMap).filter(k => !META_KEYS.has(k));

        const stops: Stop[] = [];

        for (const idx of taskIds) {
            const stopStatusStr = (typeof stopsMap[idx] === 'string')
                ? stopsMap[idx]
                : stopsMap[idx]?.state || 'pending';

            const pickupCoords = pickupLoc[idx];
            const dropCoords = dropLoc[idx];
            const isPickup = pickupCoords && pickupCoords.lat !== 11.0 && pickupCoords.lng !== 77.0;
            const type: 'pickup' | 'drop' = isPickup ? 'pickup' : 'drop';
            const loc = isPickup ? pickupCoords : dropCoords;
            const lat = loc?.lat;
            const lng = loc?.lng;
            const customer = customerIds[idx] || '';
            const locationName = loc?.location_name || loc?.address || '';
            const name = locationName || String(customer) || (lat && lng ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : `Stop ${idx}`);
            const weight = weightObj[idx] || 0;

            const etaObj = job.eta || {};
            const eta = etaObj[idx] || '';
            const stackingObj = job.stacking || {};
            const cubicObj = job.cubic_cm || {};
            const priorityObj = job.priority_based_on_order || {};
            const timeObj = job.time_constraints || {};
            const taskObj = job.task || {};

            let normalizedStatus: StopStatus = 'pending';
            if (stopStatusStr === 'completed') {
                normalizedStatus = isPickup ? 'picked_up' : 'delivered';
            } else if (jobOverall === 'interrupted' && stopStatusStr !== 'completed') {
                normalizedStatus = 'skipped';
            }

            stops.push({
                id: `${job.job_id}-${idx}`,
                jobId: String(job.job_id),
                index: String(idx),
                name, type,
                customer: String(customer),
                weight: Number(weight),
                eta: eta ? String(eta) : '',
                status: normalizedStatus,
                reason: jobOverall === 'interrupted' ? 'Job interrupted' : undefined,
                lat, lng,
                locationName,
                address: loc?.address || '',
                stacking: stackingObj[idx] ?? undefined,
                cubicCm: cubicObj[idx] ?? undefined,
                priority: priorityObj[idx] ?? undefined,
                timeConstraint: timeObj[idx] ? String(timeObj[idx]) : undefined,
                taskType: taskObj[idx] ? String(taskObj[idx]) : undefined,
            });
        }

        stops.sort((a, b) => Number(a.index) - Number(b.index));
        const completedCount = stops.filter(s => s.status === 'delivered' || s.status === 'picked_up').length;

        return {
            jobId: String(job.job_id),
            overall: jobOverall,
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
    const [userName, setUserName] = useState('Driver');

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

    const handleComplete = async (stop: Stop) => {
        setUpdatingId(stop.id);
        try {
            await updateStopStatus(stop.jobId, stop.index, 'completed');
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
        } catch {
            Alert.alert('Error', 'Failed to update status. Try again.');
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
                            await reportBreakdown(job.jobId);
                            setJobs(prev => prev.map(j =>
                                j.jobId === job.jobId
                                    ? { ...j, overall: 'interrupted' as JobOverall }
                                    : j
                            ));
                            Alert.alert('Reported', 'Managers have been notified via email.');
                        } catch {
                            Alert.alert('Error', 'Failed to report. Try again.');
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
    const totalStops = jobs.reduce((sum, j) => sum + j.totalCount, 0);
    const totalCompleted = jobs.reduce((sum, j) => sum + j.completedCount, 0);
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

            {/* Header */}
            <View style={st.header}>
                <View>
                    <Text style={st.hi}>Hello,</Text>
                    <Text style={st.name}>{userName}</Text>
                </View>
                <TouchableOpacity onPress={handleLogout} style={st.logoutBtn}>
                    <Ionicons name="log-out-outline" size={20} color="#1D1D1F" />
                </TouchableOpacity>
            </View>

            {/* Progress summary — separate card */}
            <View style={st.progressBox}>
                <View style={st.summaryCard}>
                    <View style={st.summaryLeft}>
                        <Text style={st.summaryTitle}>Today's Progress</Text>
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

    // Header
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4,
    },
    hi: { fontSize: 14, color: '#86868B' },
    name: { fontSize: 26, fontWeight: '700', color: '#1D1D1F', marginTop: 2 },
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
