import io from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';

if (!process.env.EXPO_PUBLIC_API_URL) {
    throw new Error('EXPO_PUBLIC_API_URL is not set. Check your .env file.');
}
const SOCKET_URL = process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');

export const socket = io(SOCKET_URL, {
    autoConnect: false,
    transports: ['websocket'],
});

export const connectSocket = async () => {
    const token = await SecureStore.getItemAsync('token');
    if (!token) return;
    socket.auth = { token };
    socket.connect();
};

export const disconnectSocket = () => {
    socket.disconnect();
};
