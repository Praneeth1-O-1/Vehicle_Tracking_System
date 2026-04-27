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
import { getDriverJobs, updateStopStatus, reportBreakdown, startTrip, uploadTaskExplanation, addTaskRemark, endJob } from '../services/api';
import AudioRecorder from '../components/AudioRecorder';
import { useTranslation } from '../i18n/i18n';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ───────────────────────────────────────────────────
type StopStatus = 'pending' | 'arrived' | 'completed' | 'delivered' | 'picked_up' | 'skipped' | 'location_changed_pending' | 'location_changed_completed' | 'rejected';
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
    phone?: string;
}

interface Job {
    jobId: string;
    vehicleId: string;
    overall: JobOverall;
    started: boolean;
    stops: Stop[];
    completedCount: number;
    totalCount: number;
    createdAt: string;
    updatedAt: string;
    allStopsDone?: boolean;
}

const TAB_KEYS: TabKey[] = ['pending', 'all', 'interrupted', 'completed'];

// ─── Parse Backend Jobs → Job[] ──────────────────────────────
// Backend getDriverJobs returns buildRouteResponse format:
// { job_id, vehicle_id, route_order: [ { task_id, customer_id, location, location_name, task, weight, ... } ], status, ... }

const isDone = (s: StopStatus) => s === 'delivered' || s === 'picked_up' || s === 'skipped' || s === 'location_changed_completed' || s === 'rejected';

const parseJobs = (rawJobs: any[]): Job[] => {
    return rawJobs.map(job => {
        const statusObj = job.status || {};
        const stopsStatusMap = statusObj.stops || {};
        let jobOverall = (statusObj.overall || 'pending') as JobOverall;

        // route_order is an array of task objects from buildRouteResponse
        const routeOrder: any[] = job.route_order || [];

        const stops: Stop[] = routeOrder.map((task: any) => {
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
            const customerName = task.customer_name || '';
            const locationName = task.location_name || customer;
            const name = customerName || locationName || String(customer) || (lat && lng ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : `Stop ${taskId}`);
            const weight = task.weight || 0;

            // ETA — prefer dynamicEta, fallback to scheduledTime
            const eta = task.dynamicEta || task.scheduledTime || '';

            let normalizedStatus: StopStatus = 'pending';
            if (stopStatusStr === 'arrived') {
                normalizedStatus = 'arrived';
            } else if (stopStatusStr === 'completed') {
                normalizedStatus = isPickup ? 'picked_up' : 'delivered';
            } else if (stopStatusStr === 'location_changed_pending') {
                normalizedStatus = 'location_changed_pending';
            } else if (stopStatusStr === 'location_changed_completed') {
                normalizedStatus = 'location_changed_completed';
            } else if (stopStatusStr === 'rejected') {
                normalizedStatus = 'rejected';
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
                phone: task.phone ? String(task.phone) : undefined,
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
        
        // Robustly determine if all stops are done, even if the backend all_stops_done flag is buggy for rejections
        const allStopsDoneLocal = stops.length > 0 && stops.every(s => isDone(s.status));
        const allStopsDone = !!statusObj.all_stops_done || allStopsDoneLocal;

        return {
            jobId: String(job.job_id),
            vehicleId: String(job.vehicle_id || ''),
            overall: jobOverall,
            started: !!(job.actual_start || (statusObj.start_location)),
            stops,
            completedCount,
            totalCount: stops.length,
            createdAt: job.created_at || job.assigned_at || '',
            updatedAt: job.updated_at || job.completed_at || '',
            allStopsDone,
        };
    });
};

// isDone moved above parseJobs

// jobStatusText is now inside the component to access t()

const formatJobDate = (iso: string, t: (key: string) => string): string => {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (d.toDateString() === today.toDateString()) return `${t('dashboard.today')}, ${timeStr}`;
        if (d.toDateString() === yesterday.toDateString()) return `${t('dashboard.yesterday')}, ${timeStr}`;
        return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return ''; }
};

const getJobDateLabel = (job: Job, t: (key: string) => string): string => {
    switch (job.overall) {
        case 'completed': {
            const d = formatJobDate(job.updatedAt, t);
            return d ? `${t('dashboard.completedDate')} ${d}` : '';
        }
        case 'interrupted': {
            const d = formatJobDate(job.updatedAt, t);
            return d ? `${t('dashboard.interruptedDate')} ${d}` : '';
        }
        default: {
            if (job.started) {
                const d = formatJobDate(job.updatedAt || job.createdAt, t);
                return d ? `${t('dashboard.started')} ${d}` : '';
            }
            const d = formatJobDate(job.createdAt, t);
            return d ? `${t('dashboard.assigned')} ${d}` : '';
        }
    }
};

// ═══════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════
const DashboardScreen = ({ navigation }: any) => {
    const { t } = useTranslation();

    const TABS: { key: TabKey; label: string }[] = TAB_KEYS.map(key => ({
        key,
        label: t(`dashboard.${key}`),
    }));

    const jobStatusText = (o: JobOverall) =>
        o === 'completed' ? t('dashboard.completed') : o === 'interrupted' ? t('dashboard.interrupted') : t('dashboard.inProgress');

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

            // Auto-expand the first active job
            if (!expandedJobId) {
                const activeJob = parsed.find(j => j.started && j.overall === 'pending');
                if (activeJob) {
                    setExpandedJobId(activeJob.jobId);
                }
            }
        } catch (err: any) {
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

    // ─── Late threshold: 1 minutes ───────────────────────
    const LATE_THRESHOLD_MS = 1 * 60 * 1000;

    const isTaskLate = (stop: Stop): boolean => {
        const targetTimeStr = stop.timeConstraint || stop.eta;
        if (!targetTimeStr) return false;

        let targetTimeMs: number | null = null;
        
        // 1. Try parsing as a full Date/ISO string
        const d = new Date(targetTimeStr);
        if (!isNaN(d.getTime())) {
            targetTimeMs = d.getTime();
        } else {
            // 2. Try parsing as a raw time string like "15:15" or "3:15 PM"
            const timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/;
            const match = targetTimeStr.match(timeRegex);
            if (match) {
                let hours = parseInt(match[1], 10);
                const mins = parseInt(match[2], 10);
                const modifier = match[4]?.toUpperCase();

                if (modifier === 'PM' && hours < 12) hours += 12;
                if (modifier === 'AM' && hours === 12) hours = 0;

                const now = new Date();
                now.setHours(hours, mins, 0, 0);
                targetTimeMs = now.getTime();
            }
        }

        if (targetTimeMs === null) return false;
        
        return Date.now() > (targetTimeMs + LATE_THRESHOLD_MS);
    };

    const finalizeCompletion = async (stop: Stop, lat: number, lng: number) => {
        const statusToSend = (stop as any)._useLocationChangedStatus ? 'location_changed_completed' : 'completed';
        await updateStopStatus(stop.jobId, stop.index, statusToSend, undefined, lat, lng);
        const displayStatus: StopStatus = (stop as any)._useLocationChangedStatus
            ? 'location_changed_completed'
            : (stop.type === 'pickup' ? 'picked_up' : 'delivered');
        setJobs(prev => prev.map(j => {
            if (j.jobId !== stop.jobId) return j;
            const updatedStops = j.stops.map(s =>
                s.id === stop.id ? { ...s, status: displayStatus } : s
            );
            const newCompleted = updatedStops.filter(s => s.status === 'delivered' || s.status === 'picked_up').length;
            const allDone = updatedStops.every(s => isDone(s.status));
            return {
                ...j, stops: updatedStops, completedCount: newCompleted,
                allStopsDone: allDone,
                overall: j.overall,
            };
        }));
    };

    const handleArrive = async (stop: Stop) => {
        setUpdatingId(stop.id);
        try {
            let latitude = 0;
            let longitude = 0;
            try {
                const { status: locStatus } = await Location.getForegroundPermissionsAsync();
                if (locStatus === 'granted') {
                    const loc = await Location.getLastKnownPositionAsync() || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                    if (loc) {
                        latitude = loc.coords.latitude;
                        longitude = loc.coords.longitude;
                    }
                }
            } catch (e) {}

            await updateStopStatus(stop.jobId, stop.index, 'arrived', undefined, latitude, longitude);
            
            setJobs(prev => prev.map(j => {
                if (j.jobId !== stop.jobId) return j;
                const updatedStops = j.stops.map(s =>
                    s.id === stop.id ? { ...s, status: 'arrived' as StopStatus } : s
                );
                return { ...j, stops: updatedStops };
            }));
        } catch (error: any) {
<<<<<<< HEAD
            const msg = error.response?.data?.error || error.message || t('common.somethingWentWrong');
=======
            const msg = error.response?.data?.error || t('common.genericError');
>>>>>>> 466bcce (Security fix)
            Alert.alert(t('common.error'), msg);
        } finally {
            setUpdatingId(null);
        }
    };

    const handleComplete = (stop: Stop) => {
        Alert.alert(
            t('dashboard.confirmCompletion'),
            t('dashboard.confirmCompletionMsg'),
            [
                { text: t('dashboard.cancel'), style: 'cancel' },
                {
                    text: t('dashboard.yesDone'),
                    style: 'default',
                    onPress: async () => {
                        setUpdatingId(stop.id);
                        try {
                            let latitude = 0;
                            let longitude = 0;

                            try {
                                const { status: locStatus } = await Location.getForegroundPermissionsAsync();
                                if (locStatus === 'granted') {
                                    const loc = await Location.getLastKnownPositionAsync() || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                                    if (loc) {
                                        latitude = loc.coords.latitude;
                                        longitude = loc.coords.longitude;
                                    }
                                }
                            } catch (e) {
                                // proceed even if location fetching fails
                            }

                            if (isTaskLate(stop)) {
                                setPendingLocation({ lat: latitude, lng: longitude });
                                setAudioModalStop(stop);
                                return;
                            }

                            await finalizeCompletion(stop, latitude, longitude);
                        } catch (error: any) {
<<<<<<< HEAD
                            const msg = error.response?.data?.error || error.message || t('common.somethingWentWrong');
=======
                            const msg = error.response?.data?.error || t('common.genericError');
>>>>>>> 466bcce (Security fix)
                            Alert.alert(t('common.error'), msg);
                        } finally {
                            setUpdatingId(null);
                        }
                    }
                }
            ]
        );
    };

    const handleLateAudioComplete = async (audioUri: string, durationSecs: number) => {
        if (!audioModalStop || !pendingLocation) return;
        try {
            // 1. Upload the audio explanation
            const res = await uploadTaskExplanation(audioUri, audioModalStop.jobId, audioModalStop.index, durationSecs);
            const uploadedMessageId = res?.DATA?.id;

            if (uploadedMessageId) {
                await addTaskRemark(audioModalStop.jobId, audioModalStop.index, {

                    type: 'delay',
                    text: t('common.delayedArrival'),
                    audio_message_id: uploadedMessageId
                });
            }

            // 2. Finalize the task completion
            await finalizeCompletion(audioModalStop, pendingLocation.lat, pendingLocation.lng);

            setAudioModalStop(null);
            setPendingLocation(null);
            Alert.alert(t('dashboard.done'), t('dashboard.taskDoneAudioDone'));
        } catch (error: any) {
<<<<<<< HEAD
            const msg = error.response?.data?.error || error.message || t('common.somethingWentWrong');
=======
            const msg = error.response?.data?.error || t('common.genericError');
>>>>>>> 466bcce (Security fix)
            Alert.alert(t('common.error'), msg);
        } finally {
            setUpdatingId(null);
        }
    };

    const openNavigation = (stop: Stop) => {
        if (!stop.lat || !stop.lng) {
            Alert.alert(t('dashboard.noLocation'), t('dashboard.noLocationMsg'));
            return;
        }
        Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`);
    };

    const openJobRoute = async (job: Job) => {
        const pendingStops = job.stops.filter(s => !isDone(s.status) && s.lat && s.lng);
        if (pendingStops.length === 0) {
            Alert.alert(t('dashboard.noStops'), t('dashboard.noStopsMsg'));
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

   const handleCall = async (stop: Stop) => {
    let phone = stop.phone;

    if (!phone) {
        Alert.alert(t('dashboard.noLocation'), t('dashboard.noContactNumber'));
        return;
    }

    // Clean number
    phone = phone.replace(/[^0-9]/g, '');

    // Format for India
    if (phone.startsWith('0')) {
        phone = phone.substring(1);
    }

    if (phone.length === 10) {
        phone = `+91${phone}`;
    }

    const url = `tel:${phone}`;

    try {
        // 🔥 DIRECTLY OPEN (skip canOpenURL)
        await Linking.openURL(url);
    } catch (err) {

        try {
            await Linking.openURL(`telprompt:${phone}`);
        } catch (err2) {
            Alert.alert(t('common.error'), t('dashboard.dialerError'));
        }
    }
};

    const handleStartTrip = async (job: Job) => {
        setStartingJobId(job.jobId);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert(t('dashboard.locationRequired'), t('dashboard.locationRequiredMsg'));
                setStartingJobId(null);
                return;
            }
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            await startTrip(job.jobId, loc.coords.latitude, loc.coords.longitude);
            setJobs(prev => prev.map(j =>
                j.jobId === job.jobId ? { ...j, started: true } : j
            ));
            
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setExpandedJobId(job.jobId);
            
            Alert.alert(t('dashboard.tripStarted'), t('dashboard.tripStartedMsg'));
        } catch (error: any) {
<<<<<<< HEAD
            // Location-related errors from Expo come with English messages — show translated text instead
            const isLocationError = error.message?.toLowerCase()?.includes('location') || 
                                     error.code === 'ERR_LOCATION' ||
                                     error.code === 'E_LOCATION_SETTINGS_UNSATISFIED';
            if (isLocationError) {
                Alert.alert(t('dashboard.locationRequired'), t('dashboard.locationRequiredMsg'));
            } else {
                const msg = error.response?.data?.error || error.message || t('common.somethingWentWrong');
                Alert.alert(t('common.error'), msg);
            }
=======
            const msg = error.response?.data?.error || t('common.genericError');
            Alert.alert(t('common.error'), msg);
>>>>>>> 466bcce (Security fix)
        } finally {
            setStartingJobId(null);
        }
    };

    const [endingJobId, setEndingJobId] = useState<string | null>(null);

    const handleEndJob = (job: Job) => {
        Alert.alert(
            t('dashboard.endJobTitle'),
            t('dashboard.endJobConfirmMsg', { jobId: job.jobId }),
            [
                { text: t('dashboard.cancel'), style: 'cancel' },
                {
                    text: t('dashboard.endJob'),
                    style: 'destructive',
                    onPress: async () => {
                        setEndingJobId(job.jobId);
                        try {
                            const { status } = await Location.requestForegroundPermissionsAsync();
                            let lat = 0, lng = 0;
                            if (status === 'granted') {
                                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                                lat = loc.coords.latitude;
                                lng = loc.coords.longitude;
                            }
                            await endJob(job.jobId, lat, lng);
                            setJobs(prev => prev.map(j =>
                                j.jobId === job.jobId
                                    ? { ...j, overall: 'completed' as JobOverall }
                                    : j
                            ));
                            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                            Alert.alert(t('dashboard.endJobSuccess'), t('dashboard.endJobSuccessMsg', { jobId: job.jobId }));
                        } catch (error: any) {
<<<<<<< HEAD
                            const msg = error.response?.data?.error || error.message || t('common.somethingWentWrong');
                            Alert.alert(t('common.error'), msg);
=======
                            const msg = error.response?.data?.error || t('common.genericError');
                            Alert.alert('Error', msg);
>>>>>>> 466bcce (Security fix)
                        } finally {
                            setEndingJobId(null);
                        }
                    },
                },
            ]
        );
    };

    const handleBreakdown = (job: Job) => {
        Alert.alert(
            t('dashboard.vehicleBreakdown'),
            t('dashboard.vehicleBreakdownMsg', { jobId: job.jobId }),
            [
                { text: t('dashboard.cancel'), style: 'cancel' },
                {
                    text: t('dashboard.reportBreakdownBtn'),
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
                            Alert.alert(
                                t('dashboard.breakdownReported'),
                                t('dashboard.breakdownReportedMsg'),
                                [
                                    { text: t('dashboard.later'), style: 'cancel' },
                                    {
                                        text: t('dashboard.recordMessage'),
                                        onPress: () => {
                                            navigation.navigate('AudioMessages', {
                                                breakdownContext: true,
                                                jobId: job.jobId,
                                            });
                                        },
                                    },
                                ]
                            );
                        } catch (error: any) {
<<<<<<< HEAD
                            const msg = error.response?.data?.error || error.message || t('common.somethingWentWrong');
=======
                            const msg = error.response?.data?.error || t('common.genericError');
>>>>>>> 466bcce (Security fix)
                            Alert.alert(t('common.error'), msg);
                        } finally {
                            setBreakdownJobId(null);
                        }
                    },
                },
            ]
        );
    };

    const handleLogout = async () => {
        Alert.alert(t('dashboard.logout'), t('dashboard.logoutConfirm'), [
            { text: t('dashboard.cancel'), style: 'cancel' },
            {
                text: t('dashboard.logout'), style: 'destructive',
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
        const isLocationChanged = stop.status === 'location_changed_pending';
        const isRejected = stop.status === 'rejected';

        return (
            <View key={stop.id} style={[
                st.stopCard,
                done && st.stopDone,
                isLocationChanged && { borderLeftWidth: 3, borderLeftColor: '#F59E0B', backgroundColor: '#FEF3C7' },
                isRejected && { borderLeftWidth: 3, borderLeftColor: '#EF4444' },
            ]}>

                {/* Rejected Badge */}
                {isRejected && (
                    <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                        backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 4,
                        borderRadius: 6, marginBottom: 8, alignSelf: 'flex-start',
                    }}>
                        <Ionicons name="close-circle" size={12} color="#DC2626" />
                        <Text style={{ fontSize: 11, fontWeight: '600', color: '#DC2626' }}>{t('dashboard.rejectedPermanent')}</Text>
                    </View>
                )}

                <View style={st.stopTop}>
                    <View style={st.stopInfo}>
                        <Ionicons
                            name={stop.type === 'pickup' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                            size={18}
                            color={done ? '#AEAEB2' : isLocationChanged ? '#D97706' : '#1D1D1F'}
                        />
                        <View style={{ flex: 1 }}>
                            <Text style={[st.stopLabel, done && st.stopLabelDone]}>
                                {stop.type === 'pickup' ? t('dashboard.pickup') : t('dashboard.dropOff')}
                            </Text>
                            <TouchableOpacity onPress={() => navigation.navigate('TaskDetail', { stop })} activeOpacity={0.6}>
                                <Text style={[st.stopName, done && st.stopNameDone, !done && st.stopNameLink]} numberOfLines={1}>
                                    {stop.name}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    {done && !isRejected && <Ionicons name="checkmark-circle" size={22} color="#AEAEB2" />}
                    {isRejected && <Ionicons name="close-circle" size={22} color="#EF4444" />}
                </View>

                {stop.weight > 0 && (
                    <Text style={st.stopMeta}>{stop.weight} kg</Text>
                )}

                {stop.reason && (
                    <Text style={st.stopReason}>{stop.reason}</Text>
                )}

                {!done && (
                    <View style={st.btnSection}>
                        <View style={st.btnRow}>
                            {stop.status === 'arrived' ? (
                                <TouchableOpacity
                                    style={st.btnDone}
                                    onPress={() => {
                                        if (isLocationChanged) {
                                            // For location-changed tasks, use location_changed_completed status
                                            handleComplete({ ...stop, _useLocationChangedStatus: true } as any);
                                        } else {
                                            handleComplete(stop);
                                        }
                                    }}
                                    disabled={loading}
                                >
                                    {loading
                                        ? <ActivityIndicator size="small" color="#fff" />
                                        : <><Ionicons name="checkmark" size={16} color="#fff" /><Text style={st.btnDoneText}>{t('dashboard.done')}</Text></>
                                    }
                                </TouchableOpacity>
                            ) : (
                                <TouchableOpacity
                                    style={[st.btnDone, { backgroundColor: '#F59E0B' }]}
                                    onPress={() => handleArrive(stop)}
                                    disabled={loading}
                                >
                                    {loading
                                        ? <ActivityIndicator size="small" color="#fff" />
                                        : <><Ionicons name="location-sharp" size={16} color="#fff" /><Text style={st.btnDoneText}>{t('dashboard.arrived')}</Text></>
                                    }
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity style={st.btnCall} onPress={() => handleCall(stop)}>
                                <Ionicons name="call" size={15} color="#fff" />
                                <Text style={st.btnCallText}>{t('dashboard.call')}</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={st.btnRow}>
                            <TouchableOpacity style={st.btnOutline} onPress={() => openNavigation(stop)}>
                                <Ionicons name="navigate-outline" size={15} color="#1D1D1F" />
                                <Text style={st.btnOutlineText}>{t('dashboard.map')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={st.btnOutline} onPress={() => handleSkip(stop)}>
                                <Ionicons name="flag-outline" size={15} color="#1D1D1F" />
                                <Text style={st.btnOutlineText}>{t('dashboard.reason')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[st.btnOutline, { borderColor: '#FCA5A5' }]}
                                onPress={() => navigation.navigate('RejectTask', { stop })}
                            >
                                <Ionicons name="trash-outline" size={15} color="#EF4444" />
                                <Text style={[st.btnOutlineText, { color: '#EF4444' }]}>{t('dashboard.reject')}</Text>
                            </TouchableOpacity>
                        </View>
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
                        <Text style={st.jobTitle}>{t('dashboard.job')} #{job.jobId}</Text>
                        <Text style={st.jobSub}>
                            {jobStatusText(job.overall)}  ·  {job.completedCount}/{job.totalCount} {t('dashboard.stops')}  ·  {pct}%
                        </Text>
                        {getJobDateLabel(job, t) !== '' && (
                            <View style={st.jobDateRow}>
                                <Ionicons name="calendar-outline" size={12} color="#AEAEB2" />
                                <Text style={st.jobDate}>{getJobDateLabel(job, t)}</Text>
                            </View>
                        )}
                    </View>
                    {job.overall === 'pending' && (
                        !job.started ? (
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
                                        <Text style={st.startBtnText}>{t('dashboard.start')}</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        ) : (
                            (job.allStopsDone || job.completedCount === job.totalCount) && (
                                <TouchableOpacity
                                    style={[st.startBtn, { backgroundColor: '#EF4444' }]}
                                    onPress={() => handleEndJob(job)}
                                    activeOpacity={0.7}
                                    disabled={endingJobId === job.jobId}
                                >
                                    {endingJobId === job.jobId ? (
                                        <ActivityIndicator size="small" color="#fff" />
                                    ) : (
                                        <>
                                            <Ionicons name="checkmark-done" size={14} color="#fff" />
                                            <Text style={st.startBtnText}>{t('dashboard.endJob')}</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            )
                        )
                    )}
                    {job.overall === 'pending' && (
                        <TouchableOpacity style={st.jobMapBtn} onPress={() => openJobRoute(job)} activeOpacity={0.7}>
                            <Ionicons name="map-outline" size={16} color="#fff" />
                            <Text style={st.jobMapBtnText}>{t('dashboard.route')}</Text>
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
                                        <Text style={st.breakdownLabel}>{t('dashboard.reportBreakdown')}</Text>
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
                            title={t('dashboard.lateTaskTitle')}
                            subtitle={t('dashboard.lateTaskSubtitle', { index: audioModalStop?.index || '' })}
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
                    <Text style={st.hi}>{t('dashboard.hello')}</Text>
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
                        <Text style={st.summaryTitle}>{t('dashboard.pendingJobProgress')}</Text>
                        <Text style={st.summaryCount}>
                            {totalCompleted}<Text style={st.summaryOf}> / {totalStops} {t('dashboard.stops')}</Text>
                        </Text>
                    </View>
                    <Text style={st.summaryPct}>{Math.round(progress * 100)}%</Text>
                </View>
                <View style={st.summaryBarTrack}>
                    <View style={[st.summaryBarFill, { width: `${progress * 100}%` }]} />
                </View>
            </View>

            {/* Tabs */}
            <View style={st.tabBarContainer}>
                <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={st.tabBar}
                >
                    {TABS.map(tab => {
                        const active = activeTab === tab.key;
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
                </ScrollView>
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
                            <Text style={st.emptyTitle}>{t('dashboard.noJobsHere')}</Text>
                            <Text style={st.emptyBody}>{t('dashboard.pullToRefresh')}</Text>
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
    tabBarContainer: {
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA',
    },
    tabBar: {
        flexDirection: 'row', paddingHorizontal: 20,
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
    jobDateRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    jobDate: { fontSize: 12, color: '#AEAEB2', fontWeight: '500' },
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

    // End Job button
    endJobRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        marginHorizontal: 20, marginTop: 12, marginBottom: 4,
        paddingVertical: 14, paddingHorizontal: 16,
        borderRadius: 10, backgroundColor: '#34C759',
    },
    endJobLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },

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
    btnSection: { marginTop: 12, gap: 8 },
    btnRow: { flexDirection: 'row', gap: 8 },
    btnDone: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        backgroundColor: '#1D1D1F', paddingVertical: 11, borderRadius: 10,
    },
    btnDoneText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    btnCall: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        backgroundColor: '#16A34A', paddingVertical: 11, borderRadius: 10,
    },
    btnCallText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    btnOutline: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        paddingVertical: 11, borderRadius: 10,
        borderWidth: 1, borderColor: '#E5E5EA',
    },
    btnOutlineText: { fontSize: 13, fontWeight: '500', color: '#1D1D1F' },

    // Loading & empty
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { flex: 1 },
    listPad: { paddingBottom: 40 },
    empty: { paddingTop: 80, alignItems: 'center', gap: 6 },
    emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1D1D1F' },
    emptyBody: { fontSize: 14, color: '#86868B' },
});

export default DashboardScreen;
