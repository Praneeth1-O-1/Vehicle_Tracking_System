import io from 'socket.io-client';

const SOCKET_URL = 'http://51.20.128.131';

export const socket = io(SOCKET_URL, {
    autoConnect: false,
    transports: ['websocket'],
});

