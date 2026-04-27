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
    Dimensions,
    Modal,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { login } from '../services/api';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation, LANGUAGES, LanguageCode } from '../i18n/i18n';

const { width } = Dimensions.get('window');

const LoginScreen = ({ navigation }: any) => {
    const { t, language, setLanguage } = useTranslation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(true);
    const [langDropdownVisible, setLangDropdownVisible] = useState(false);
    const [savedCreds, setSavedCreds] = useState<{ username: string; password: string } | null>(null);

    // Animations
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(40)).current;

    useEffect(() => {
        const checkLogin = async () => {
            const token = await SecureStore.getItemAsync('token');
            const loginTime = await SecureStore.getItemAsync('loginTime');

            const showLoginForm = () => {
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
            };

            if (token && loginTime) {
                const ONE_DAY = 24 * 60 * 60 * 1000;
                const elapsed = Date.now() - parseInt(loginTime, 10);

                if (elapsed < ONE_DAY) {
                    // ✅ Session still valid — go to Dashboard
                    navigation.replace('Dashboard');
                } else {
                    // ❌ Session expired — clear credentials and show login
                    await SecureStore.deleteItemAsync('token');
                    await SecureStore.deleteItemAsync('loginTime');
                    await SecureStore.deleteItemAsync('user');
                    showLoginForm();
                }
            } else {
                // No token stored — show login form
                showLoginForm();
            }

            // Auto-fill saved credentials into the form
            const savedUser = await SecureStore.getItemAsync('savedUsername');
            const savedPass = await SecureStore.getItemAsync('savedPassword');
            if (savedUser && savedPass) {
                setSavedCreds({ username: savedUser, password: savedPass });
                setUsername(savedUser);
                setPassword(savedPass);
            }
        };
        checkLogin();
    }, []);

    const loginMutation = useMutation({
        mutationFn: ({ e, p }: { e: string; p: string }) => login(e, p),
        onSuccess: (_data, variables) => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

            // Case 1: Exact match — credentials already saved, go straight
            if (savedCreds && savedCreds.username === variables.e && savedCreds.password === variables.p) {
                navigation.replace('Dashboard');
                return;
            }

            // Case 2: Same username, different password — ask to update
            if (savedCreds && savedCreds.username === variables.e && savedCreds.password !== variables.p) {
                Alert.alert(
                    t('login.updatePassword'),
                    t('login.updatePasswordMsg'),
                    [
                        {
                            text: t('login.noThanks'),
                            style: 'cancel',
                            onPress: () => navigation.replace('Dashboard'),
                        },
                        {
                            text: t('login.yesUpdate'),
                            onPress: async () => {
                                await SecureStore.setItemAsync('savedPassword', variables.p);
                                navigation.replace('Dashboard');
                            },
                        },
                    ],
                    { cancelable: false }
                );
                return;
            }

            // Case 3: New user or no saved creds — ask to save
            Alert.alert(
                t('login.saveCredentials'),
                t('login.saveCredentialsMsg'),
                [
                    {
                        text: t('login.noThanks'),
                        style: 'cancel',
                        onPress: () => navigation.replace('Dashboard'),
                    },
                    {
                        text: t('login.yesSave'),
                        onPress: async () => {
                            await SecureStore.setItemAsync('savedUsername', variables.e);
                            await SecureStore.setItemAsync('savedPassword', variables.p);
                            navigation.replace('Dashboard');
                        },
                    },
                ],
                { cancelable: false }
            );
        },
        onError: (error: any) => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
<<<<<<< HEAD
            Alert.alert(t('login.loginFailed'), error.response?.data?.MESSAGE || error.message || t('common.somethingWentWrong'));
=======
            const status = error.response?.status;
            const serverMsg = error.response?.data?.MESSAGE;
            const msg = (status === 401 || status === 400) && serverMsg
                ? serverMsg
                : t('login.somethingWentWrong');
            Alert.alert(t('login.loginFailed'), msg);
>>>>>>> 466bcce (Security fix)
        },
    });

    const handleLogin = () => {
        if (!username || !password) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return Alert.alert(t('login.error'), t('login.enterCredentials'));
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        loginMutation.mutate({ e: username, p: password });
    };



    const handleLanguageSelect = (code: LanguageCode) => {
        setLanguage(code);
        setLangDropdownVisible(false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

            {/* Language Dropdown Modal */}
            <Modal
                visible={langDropdownVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setLangDropdownVisible(false)}
            >
                <TouchableOpacity
                    style={styles.langModalOverlay}
                    activeOpacity={1}
                    onPress={() => setLangDropdownVisible(false)}
                >
                    <View style={styles.langDropdown}>
                        <View style={styles.langDropdownHeader}>
                            <View style={styles.langIconSmall}>
                                <Text style={styles.langIconA}>A</Text>
                                <Text style={styles.langIconZh}>文</Text>
                            </View>
                            <Text style={styles.langDropdownTitle}>
                                {language === 'en' ? 'Select Language' : language === 'ta' ? 'மொழியை தேர்ந்தெடுக்கவும்' : 'भाषा चुनें'}
                            </Text>
                        </View>
                        {LANGUAGES.map((lang) => {
                            const isActive = language === lang.code;
                            return (
                                <TouchableOpacity
                                    key={lang.code}
                                    style={[styles.langOption, isActive && styles.langOptionActive]}
                                    onPress={() => handleLanguageSelect(lang.code)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[styles.langLabel, isActive && styles.langLabelActive]}>
                                        {lang.label}
                                    </Text>
                                    {isActive && (
                                        <Ionicons name="checkmark-circle" size={20} color="#EF4444" />
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </TouchableOpacity>
            </Modal>

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
                        <Text style={styles.welcomeText}>{t('login.welcomeBack')}</Text>
                        <Text style={styles.subText}>{t('login.subtitle')}</Text>
                    </View>

                    {/* Form */}
                    <View style={styles.formContainer}>
                        <View style={styles.inputGroup}>
                            <Ionicons name="person-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder={t('login.username')}
                                placeholderTextColor="#9CA3AF"
                                autoCapitalize="none"
                                value={username}
                                onChangeText={setUsername}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder={t('login.password')}
                                placeholderTextColor="#9CA3AF"
                                secureTextEntry
                                value={password}
                                onChangeText={setPassword}
                            />
                        </View>

                        {/* Language Button + Forgot Password Row */}
                        <View style={styles.forgotRow}>
                            <TouchableOpacity
                                style={styles.langBtn}
                                activeOpacity={0.7}
                                onPress={() => setLangDropdownVisible(true)}
                            >
                                <View style={styles.langBtnIcon}>
                                    <View style={styles.langBtnLeft}>
                                        <Text style={styles.langBtnA}>A</Text>
                                    </View>
                                    <View style={styles.langBtnRight}>
                                        <Text style={styles.langBtnZh}>文</Text>
                                    </View>
                                </View>
                                <Text style={styles.langBtnText}>
                                    {LANGUAGES.find(l => l.code === language)?.label || 'English'}
                                </Text>
                                <Ionicons name="chevron-down" size={14} color="#6B7280" />
                            </TouchableOpacity>

                            <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={() => Alert.alert(t('login.resetPassword'), t('login.resetPasswordMsg'))}
                            >
                                <Text style={styles.forgotText}>{t('login.forgotPassword')}</Text>
                            </TouchableOpacity>
                        </View>

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
                                    <Text style={styles.loginBtnText}>{t('login.signIn')}</Text>
                                )}
                            </LinearGradient>
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

    // Forgot row — language button on left, forgot password on right
    forgotRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },

    forgotText: { color: '#EF4444', fontWeight: '600', fontSize: 14 },

    // Language button (Google Translate style)
    langBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 10,
        backgroundColor: '#F3F4F6',
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    langBtnIcon: {
        flexDirection: 'row',
        width: 28,
        height: 20,
        borderRadius: 4,
        overflow: 'hidden',
    },
    langBtnLeft: {
        flex: 1,
        backgroundColor: '#4285F4',
        justifyContent: 'center',
        alignItems: 'center',
    },
    langBtnRight: {
        flex: 1,
        backgroundColor: '#E0E0E0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    langBtnA: {
        fontSize: 11,
        fontWeight: '800',
        color: '#fff',
    },
    langBtnZh: {
        fontSize: 10,
        fontWeight: '700',
        color: '#5F6368',
    },
    langBtnText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#374151',
    },

    // Language dropdown modal
    langModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.35)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    langDropdown: {
        backgroundColor: '#fff',
        borderRadius: 20,
        width: width * 0.78,
        paddingVertical: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 24,
        elevation: 10,
    },
    langDropdownHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E5E7EB',
    },
    langIconSmall: {
        flexDirection: 'row',
        width: 36,
        height: 26,
        borderRadius: 6,
        overflow: 'hidden',
    },
    langIconA: {
        flex: 1,
        backgroundColor: '#4285F4',
        textAlign: 'center',
        textAlignVertical: 'center',
        lineHeight: 26,
        fontSize: 14,
        fontWeight: '800',
        color: '#fff',
    },
    langIconZh: {
        flex: 1,
        backgroundColor: '#E0E0E0',
        textAlign: 'center',
        textAlignVertical: 'center',
        lineHeight: 26,
        fontSize: 13,
        fontWeight: '700',
        color: '#5F6368',
    },
    langDropdownTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1F2937',
    },
    langOption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 14,
    },
    langOptionActive: {
        backgroundColor: '#FEF2F2',
    },
    langFlag: {
        fontSize: 20,
    },
    langLabel: {
        flex: 1,
        fontSize: 15,
        fontWeight: '500',
        color: '#374151',
    },
    langLabelActive: {
        fontWeight: '700',
        color: '#EF4444',
    },

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

});

export default LoginScreen;
