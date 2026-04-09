import io from 'socket.io-client';

const RAW_URL = process.env.EXPO_PUBLIC_API_URL || 'http://51.20.128.131';
const SOCKET_URL = RAW_URL.replace(/\/$/, '');

export const socket = io(SOCKET_URL, {
    autoConnect: false,
    transports: ['websocket'],
});

