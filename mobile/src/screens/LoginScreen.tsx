import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    Animated,
    StatusBar,
    Image,
    Dimensions
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { login } from '../services/api';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

const LoginScreen = ({ navigation }: any) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(true);

    // Animations
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(40)).current;

    useEffect(() => {
        const checkLogin = async () => {
            const token = await SecureStore.getItemAsync('token');
            if (token) {
                navigation.replace('Dashboard');
            } else {
                setLoading(false);
                Animated.parallel([
                    Animated.timing(fadeAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.spring(slideAnim, {
                        toValue: 0,
                        tension: 20,
                        friction: 7,
                        useNativeDriver: true,
                    })
                ]).start();
            }
        };
        checkLogin();
    }, []);

    const loginMutation = useMutation({
        mutationFn: ({ e, p }: { e: string; p: string }) => login(e, p),
        onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            navigation.replace('Dashboard');
        },
        onError: (error: any) => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('Login Failed', error.response?.data?.MESSAGE || error.message || 'Something went wrong');
        },
    });

    const handleLogin = () => {
        if (!email || !password) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return Alert.alert('Error', 'Please enter email and password');
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        loginMutation.mutate({ e: email, p: password });
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <StatusBar barStyle="dark-content" />
                <ActivityIndicator size="large" color="#EF4444" />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" />

            {/* Background Decor */}
            <View style={styles.backgroundCircle} />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardView}
            >
                <Animated.View
                    style={[
                        styles.content,
                        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
                    ]}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <Image source={require('../../assets/circor-logo-3.png')} style={styles.logo} resizeMode="contain" />
                        <Text style={styles.welcomeText}>Welcome Back</Text>
                        <Text style={styles.subText}>Sign in to access your fleet dashboard</Text>
                    </View>

                    {/* Form */}
                    <View style={styles.formContainer}>
                        <View style={styles.inputGroup}>
                            <Ionicons name="mail-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Email Address"
                                placeholderTextColor="#9CA3AF"
                                autoCapitalize="none"
                                keyboardType="email-address"
                                value={email}
                                onChangeText={setEmail}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Password"
                                placeholderTextColor="#9CA3AF"
                                secureTextEntry
                                value={password}
                                onChangeText={setPassword}
                            />
                        </View>

                        <TouchableOpacity
                            style={styles.forgotBtn}
                            activeOpacity={0.7}
                            onPress={() => Alert.alert('Reset Password', 'Please contact admin to reset credentials.')}
                        >
                            <Text style={styles.forgotText}>Forgot Password?</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={handleLogin}
                            disabled={loginMutation.isPending}
                            activeOpacity={0.9}
                            style={styles.loginBtn}
                        >
                            <LinearGradient
                                colors={['#EF4444', '#DC2626']}
                                style={styles.btnGradient}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                            >
                                {loginMutation.isPending ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.loginBtnText}>Sign In</Text>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>

                    {/* Footer */}
                    <View style={styles.footer}>
                        <Text style={styles.footerText}>Need an account? </Text>
                        <TouchableOpacity onPress={() => Alert.alert('Contact Admin', 'Driver accounts are created by fleet managers.')}>
                            <Text style={styles.linkText}>Contact Admin</Text>
                        </TouchableOpacity>
                    </View>
                </Animated.View>
            </KeyboardAvoidingView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    loadingContainer: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
    keyboardView: { flex: 1, justifyContent: 'center' },

    // Background Decor
    backgroundCircle: {
        position: 'absolute',
        top: -100,
        right: -100,
        width: 300,
        height: 300,
        borderRadius: 150,
        backgroundColor: '#FEE2E2', // Very light red
        opacity: 0.5,
    },

    content: { paddingHorizontal: 24, width: '100%', maxWidth: 400, alignSelf: 'center' },

    header: { marginBottom: 40 },
    logo: {
        width: 240, height: 90,
        alignSelf: 'flex-start',
        marginLeft: -16,
        marginBottom: 10,
    },
    welcomeText: { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 8 },
    subText: { fontSize: 15, color: '#6B7280', lineHeight: 22 },

    formContainer: { marginBottom: 24 },
    inputGroup: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        height: 56,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.02,
        shadowRadius: 4,
        elevation: 1,
    },
    inputIcon: { marginLeft: 16, marginRight: 12 },
    input: { flex: 1, color: '#111', fontSize: 16, height: '100%' },

    forgotBtn: { alignSelf: 'flex-end', marginBottom: 24 },
    forgotText: { color: '#EF4444', fontWeight: '600', fontSize: 14 },

    loginBtn: {
        borderRadius: 16,
        shadowColor: '#EF4444',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 6,
    },
    btnGradient: {
        height: 56,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },

    footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 16 },
    footerText: { color: '#6B7280', fontSize: 14 },
    linkText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },
});

export default LoginScreen;
