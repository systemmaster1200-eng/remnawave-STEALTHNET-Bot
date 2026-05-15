import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Admin, AuthState } from "@/lib/api";
import { api, setTokenRefreshFn } from "@/lib/api";

const STORAGE_KEYS = {
  access: "stealthnet_access_token",
  refresh: "stealthnet_refresh_token",
  admin: "stealthnet_admin",
};

function loadState(): AuthState {
  const access = localStorage.getItem(STORAGE_KEYS.access);
  const refresh = localStorage.getItem(STORAGE_KEYS.refresh);
  const adminRaw = localStorage.getItem(STORAGE_KEYS.admin);
  const admin = adminRaw ? (JSON.parse(adminRaw) as Admin) : null;
  return { accessToken: access, refreshToken: refresh, admin, pending2FAToken: null };
}

function saveState(state: AuthState) {
  if (state.accessToken) localStorage.setItem(STORAGE_KEYS.access, state.accessToken);
  else localStorage.removeItem(STORAGE_KEYS.access);
  if (state.refreshToken) localStorage.setItem(STORAGE_KEYS.refresh, state.refreshToken);
  else localStorage.removeItem(STORAGE_KEYS.refresh);
  if (state.admin) localStorage.setItem(STORAGE_KEYS.admin, JSON.stringify(state.admin));
  else localStorage.removeItem(STORAGE_KEYS.admin);
}

function clearState() {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
}

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  /** Ввести код 2FA после ответа requires2FA */
  submit2FACode: (code: string) => Promise<void>;
  /** Отменить шаг 2FA */
  clearPending2FA: () => void;
  logout: () => Promise<void>;
  setTokens: (access: string, refresh: string, admin: Admin) => void;
  updateAdmin: (admin: Admin) => void;
  /** Возвращает новый access token при успехе, null при ошибке. */
  refreshAccess: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(loadState);

  const setTokens = useCallback((access: string, refresh: string, admin: Admin) => {
    const next = { accessToken: access, refreshToken: refresh, admin, pending2FAToken: null as string | null };
    setState(next);
    saveState(next);
  }, []);

  const updateAdmin = useCallback((admin: Admin) => {
    setState((prev) => {
      if (!prev.admin) return prev;
      const next = { ...prev, admin };
      saveState(next);
      return next;
    });
  }, []);

  const refreshAccess = useCallback(async (): Promise<string | null> => {
    const refresh = state.refreshToken;
    if (!refresh) return null;
    try {
      const res = await api.refresh(refresh);
      setTokens(res.accessToken, refresh, res.admin);
      return res.accessToken;
    } catch {
      clearState();
      setState({ accessToken: null, refreshToken: null, admin: null, pending2FAToken: null });
      return null;
    }
  }, [state.refreshToken, setTokens]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      if ("requires2FA" in res && res.requires2FA) {
        setState((prev) => ({ ...prev, pending2FAToken: res.tempToken }));
        return;
      }
      const auth = res as import("@/lib/api").LoginResponse;
      setTokens(auth.accessToken, auth.refreshToken, auth.admin);
    },
    [setTokens]
  );

  const submit2FACode = useCallback(
    async (code: string) => {
      const tempToken = state.pending2FAToken;
      if (!tempToken?.trim()) return;
      const res = await api.admin2FALogin(tempToken, code.trim());
      const next = { accessToken: res.accessToken, refreshToken: res.refreshToken, admin: res.admin, pending2FAToken: null as string | null };
      setState(next);
      saveState(next);
    },
    [state.pending2FAToken]
  );

  const clearPending2FA = useCallback(() => {
    setState((prev) => ({ ...prev, pending2FAToken: null }));
  }, []);

  const logout = useCallback(async () => {
    await api.logout(state.refreshToken);
    clearState();
    setState({ accessToken: null, refreshToken: null, admin: null, pending2FAToken: null });
  }, [state.refreshToken]);

  useEffect(() => {
    setTokenRefreshFn(() => refreshAccess());
    return () => setTokenRefreshFn(null);
  }, [refreshAccess]);

  useEffect(() => {
    if (!state.accessToken && state.refreshToken) {
      refreshAccess();
    }
  }, []);

  const value: AuthContextValue = {
    state,
    login,
    submit2FACode,
    clearPending2FA,
    logout,
    setTokens,
    updateAdmin,
    refreshAccess,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
