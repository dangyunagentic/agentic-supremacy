'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Role } from '@mintbot/shared';

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  role: Role;
  telegramId: string | null;
}

interface AuthState {
  user: SessionUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (user: SessionUser, accessToken: string, refreshToken: string) => void;
  updateTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setSession: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      updateTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: 'mintbot-auth' },
  ),
);
