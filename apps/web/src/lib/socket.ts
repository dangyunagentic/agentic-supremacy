'use client';

import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from './auth-store';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket?.connected) return socket;
  const token = useAuthStore.getState().accessToken;
  socket = io(process.env.NEXT_PUBLIC_WS_URL ?? '', {
    auth: { token },
    transports: ['websocket'],
    reconnectionAttempts: 10,
  });
  return socket;
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = null;
}
