import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    StatusBar,
    Linking,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const TaskDetailScreen = ({ navigation, route }: any) => {
    const { stop } = route.params || {};

    if (!stop) {
        return (
            <SafeAreaView style={s.container}>
                <Text style={{ padding: 20 }}>No task data available.</Text>
            </SafeAreaView>
        );
    }

    const openMap = () => {
        if (!stop.lat || !stop.lng) {
            Alert.alert('No Location', 'Coordinates not available for this stop.');
            return;
        }
        Linking.openURL(
            `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`
        );
    };

    const statusLabel = (status: string) => {
        switch (status) {
            case 'delivered': return 'Delivered';
            case 'picked_up': return 'Picked Up';
            case 'skipped': return 'Skipped';
            default: return 'Pending';
        }
    };

    const statusColor = (status: string) => {
        switch (status) {
            case 'delivered':
            case 'picked_up': return '#16A34A';
            case 'skipped': return '#EA580C';
            default: return '#007AFF';
        }
    };

    return (
        <SafeAreaView style={s.container}>
            <StatusBar barStyle="dark-content" />

            {/* Header */}
            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
                    <Ionicons name="chevron-back" size={20} color="#1E293B" />
                </TouchableOpacity>
                <Text style={s.headerTitle}>Task Details</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Location heading */}
                <View style={s.heroCard}>
                    <View style={s.heroIconRow}>
                        <View style={[s.heroIcon, { backgroundColor: stop.type === 'pickup' ? '#DCFCE7' : '#FEE2E2' }]}>
                            <Ionicons
                                name={stop.type === 'pickup' ? 'arrow-up-circle' : 'arrow-down-circle'}
                                size={24}
                                color={stop.type === 'pickup' ? '#16A34A' : '#DC2626'}
                            />
                        </View>
                        <View style={[s.statusBadge, { backgroundColor: statusColor(stop.status) + '18' }]}>
                            <View style={[s.statusDot, { backgroundColor: statusColor(stop.status) }]} />
                            <Text style={[s.statusText, { color: statusColor(stop.status) }]}>
                                {statusLabel(stop.status)}
                            </Text>
                        </View>
                    </View>
                    <Text style={s.heroLabel}>
                        {stop.type === 'pickup' ? 'Pickup Location' : 'Drop-off Location'}
                    </Text>
                    <Text style={s.heroName}>{stop.name}</Text>
                    {stop.locationName && stop.locationName !== stop.name && (
                        <Text style={s.heroSub}>{stop.locationName}</Text>
                    )}
                    {stop.lat && stop.lng && (
                        <Text style={s.heroCoords}>{stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}</Text>
                    )}
                </View>

                {/* Details grid */}
                <Text style={s.sectionTitle}>Task Information</Text>
                <View style={s.detailsCard}>
                    <DetailRow icon="person-outline" label="Customer ID" value={stop.customer || '—'} />
                    <DetailRow icon="cube-outline" label="Weight" value={stop.weight ? `${stop.weight} kg` : '—'} />
                    <DetailRow icon="time-outline" label="ETA" value={stop.eta || '—'} />
                    <DetailRow icon="layers-outline" label="Stacking" value={stop.stacking != null ? String(stop.stacking) : '—'} />
                    <DetailRow icon="resize-outline" label="Volume" value={stop.cubicCm != null ? `${stop.cubicCm} cm³` : '—'} />
                    <DetailRow icon="flag-outline" label="Priority" value={stop.priority != null ? String(stop.priority) : '—'} />
                    <DetailRow icon="alarm-outline" label="Time Constraint" value={stop.timeConstraint || '—'} />
                    <DetailRow icon="construct-outline" label="Task Type" value={stop.taskType || '—'} last />
                </View>

                {stop.reason && (
                    <>
                        <Text style={s.sectionTitle}>Reason</Text>
                        <View style={s.reasonCard}>
                            <Ionicons name="alert-circle-outline" size={18} color="#EA580C" />
                            <Text style={s.reasonText}>{stop.reason}</Text>
                        </View>
                    </>
                )}

                {/* Map button */}
                {stop.lat && stop.lng && (
                    <TouchableOpacity style={s.mapBtn} activeOpacity={0.8} onPress={openMap}>
                        <Ionicons name="navigate" size={18} color="#fff" />
                        <Text style={s.mapBtnText}>Open in Google Maps</Text>
                    </TouchableOpacity>
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

// ─── Detail Row Component ─────────────────────────────
const DetailRow = ({ icon, label, value, last }: { icon: string; label: string; value: string; last?: boolean }) => (
    <View style={[dr.row, !last && dr.rowBorder]}>
        <View style={dr.labelRow}>
            <Ionicons name={icon as any} size={16} color="#94A3B8" />
            <Text style={dr.label}>{label}</Text>
        </View>
        <Text style={dr.value} numberOfLines={1}>{value}</Text>
    </View>
);

const dr = StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13 },
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F1F5F9' },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    label: { fontSize: 13, color: '#64748B', fontWeight: '500' },
    value: { fontSize: 14, color: '#1E293B', fontWeight: '600', maxWidth: '50%', textAlign: 'right' },
});

// ─── Main Styles ──────────────────────────────────────
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

    // Hero card
    heroCard: {
        backgroundColor: '#fff', borderRadius: 16, padding: 20,
        borderWidth: 1, borderColor: '#F1F5F9', marginBottom: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03, shadowRadius: 8, elevation: 1,
    },
    heroIconRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14,
    },
    heroIcon: {
        width: 44, height: 44, borderRadius: 12,
        alignItems: 'center', justifyContent: 'center',
    },
    statusBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusText: { fontSize: 12, fontWeight: '600' },
    heroLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
    heroName: { fontSize: 20, fontWeight: '800', color: '#1E293B', marginTop: 4 },
    heroSub: { fontSize: 14, color: '#64748B', marginTop: 4 },
    heroCoords: { fontSize: 12, color: '#94A3B8', marginTop: 6, fontFamily: 'monospace' },

    // Section
    sectionTitle: { fontSize: 13, fontWeight: '600', color: '#64748B', marginBottom: 10, letterSpacing: 0.3 },

    // Details card
    detailsCard: {
        backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 16,
        borderWidth: 1, borderColor: '#F1F5F9', marginBottom: 24,
    },

    // Reason
    reasonCard: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: '#FFF7ED', borderRadius: 12, padding: 14,
        borderWidth: 1, borderColor: '#FFEDD5', marginBottom: 24,
    },
    reasonText: { fontSize: 14, color: '#9A3412', fontWeight: '500', flex: 1 },

    // Map button
    mapBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: '#1E293B', paddingVertical: 16, borderRadius: 14,
        shadowColor: '#1E293B', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2, shadowRadius: 10, elevation: 4,
    },
    mapBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

export default TaskDetailScreen;
