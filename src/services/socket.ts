import io from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';

const RAW_URL = process.env.EXPO_PUBLIC_API_URL || 'http://51.20.128.131';
const SOCKET_URL = RAW_URL.replace(/\/$/, '');

export const socket = io(SOCKET_URL, {
    autoConnect: false,
    transports: ['websocket'],
});

// Connect with the stored JWT so the backend can authenticate the driver
// (required for driver-room membership and the mobile-GPS fallback stream).
export const connectSocket = async () => {
    const token = await SecureStore.getItemAsync('token');
    if (!token) return;
    socket.auth = { token };
    socket.connect();
};

/**
 * Reconnect if the socket has dropped. Safe (and cheap) to call repeatedly.
 *
 * Socket.IO's own reconnect loop runs on JS timers, which Android freezes while
 * the app is backgrounded — so once the socket drops in the background it stays
 * down until the app is foregrounded. The background location task calls this on
 * every GPS tick instead: that task is driven by the foreground service, not by
 * JS timers, so it keeps running and gives the control channel a heartbeat that
 * survives Doze.
 */
export const ensureSocketConnected = async () => {
    if (socket.connected) return;
    await connectSocket();
};

export const disconnectSocket = () => {
    socket.disconnect();
};
