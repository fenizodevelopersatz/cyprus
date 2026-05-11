import { create } from "zustand";
import {
  apiLogin,
  apiRegister,
  apiMe,
  apiLoginWithGoogle,
  apiAdminLogin,
  apiRequestPasswordReset,
  apiResetPassword,
} from "../api/auth.api";
import type {
  User,
  LoginResponse,
  PasswordResetConfirmResponse,
  PasswordResetRequestResponse,
} from "../types";
import type { ForgotPasswordPayload, RegisterPayload, ResetPasswordPayload } from "../api/auth.api";
import { clearUserSessionTokens, setUserSessionTokens } from "./session.storage";

type AuthState = {
  user: User | null;
  login: (email: string, password: string, remember?: boolean, otp?: string) => Promise<LoginResponse>;
  loginAdmin: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  requestPasswordReset: (payload: ForgotPasswordPayload) => Promise<PasswordResetRequestResponse>;
  resetPassword: (payload: ResetPasswordPayload) => Promise<PasswordResetConfirmResponse>;
  loadMe: () => Promise<void>;
  applySession: (accessToken: string, refreshToken?: string, remember?: boolean) => Promise<void>;
  logout: () => void;
  clearAdminSession: () => void;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  async login(email, password, remember = true, otp) {
    const res = await apiLogin(email, password, remember, otp);
    if (res.status === "success") {
      setUserSessionTokens({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        remember,
      });
      set({ user: res.user });
    }
    return res;
  },
  async loginAdmin(email, password) {
    const res = await apiAdminLogin(email, password);
    localStorage.setItem("adminAccessToken", res.accessToken);
    localStorage.setItem("adminRefreshToken", res.refreshToken);
  },
  async loginWithGoogle() {
    await apiLoginWithGoogle();
  },
  async register(payload) {
    await apiRegister(payload);
  },
  async requestPasswordReset(payload) {
    return apiRequestPasswordReset(payload);
  },
  async resetPassword(payload) {
    return apiResetPassword(payload);
  },
  async loadMe() {
    const me = await apiMe();
    set({ user: me });
  },
  async applySession(accessToken, refreshToken, remember = true) {
    setUserSessionTokens({ accessToken, refreshToken, remember });
    const me = await apiMe(accessToken);
    set({ user: me });
  },
  logout() {
    clearUserSessionTokens();
    sessionStorage.removeItem("twoFactorVerified");
    set({ user: null });
  },
  clearAdminSession() {
    localStorage.removeItem("adminAccessToken");
    localStorage.removeItem("adminRefreshToken");
  },
}));
