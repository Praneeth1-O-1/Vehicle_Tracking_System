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

export const disconnectSocket = () => {
    socket.disconnect();
};
