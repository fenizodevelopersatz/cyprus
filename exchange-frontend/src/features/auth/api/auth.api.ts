import api from "../../../app/axios";
import { API_ROUTES, AUTH_ENDPOINTS } from "../../../app/apiRoutes";
import type {
  LoginResp,
  LoginResponse,
  PasswordResetConfirmResponse,
  PasswordResetRequestResponse,
  User,
} from "../types";

const MOCK = import.meta.env.VITE_MOCK_MODE === "1";

// --- helpers for mock ---
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));
const mockUser: User = {
  id: 101,
  name: "Demo User",
  email: "demo@exchange.test",
  kycStatus: "pending",
  country: "United States",
};

type ApiEnvelope<T> = {
  status: boolean;
  code: number;
  data: T;
};

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

type LoginPayload = {
  access?: string;
  refresh?: string;
  user?: User;
  otpRequired?: boolean;
  expiresAt?: string;
  message?: string;
  factorType?: "email" | "authenticator";
  code?: string;
};

export type RegisterPayload = {
  name: string;
  email: string;
  password: string;
  country: string;
  countryCode?: string;
  referralCode?: string;
};

export type ForgotPasswordPayload = {
  email: string;
};

export type ResetPasswordPayload = {
  email: string;
  otp: string;
  password: string;
};

const fallbackUser = (email: string): User => ({
  id: 0,
  name: email.includes("@") ? email.split("@")[0] || email : email,
  email,
});

export const apiRegister = async (payload: RegisterPayload): Promise<User> => {
  const { name, email, password, country, countryCode, referralCode } = payload;
  if (MOCK) {
    await delay(500);
    return { ...mockUser, name, email, country };
  }
  const body: Record<string, unknown> = { name, email, password, country };
  if (countryCode) body.country = countryCode;
  if (referralCode) body.referralCode = referralCode;

  return api.post(API_ROUTES.auth.register, body).then((r) => unwrap<User>(r.data));
};

const resolveLoginTokens = async (payload: LoginPayload, email: string): Promise<LoginResp> => {
  if (!payload?.access) {
    throw new Error("Login response missing access token");
  }

  let user = payload.user;
  if (!user) {
    try {
      user = await apiMe(payload.access);
    } catch {
      user = fallbackUser(email);
    }
  }

  return {
    accessToken: payload.access,
    refreshToken: payload.refresh ?? "",
    user,
  };
};

export const apiLogin = async (
  email: string,
  password: string,
  remember = true,
  otp?: string
): Promise<LoginResponse> => {
  if (MOCK) {
    await delay(500);
    return {
      status: "success",
      accessToken: "mock.access.token",
      refreshToken: "mock.refresh.token",
      user: { ...mockUser, email },
    };
  }

  const payload = await api
    .post(API_ROUTES.auth.login, { email, password, remember, ...(otp ? { otp } : {}) })
    .then((r) => unwrap<LoginPayload>(r.data));

  if (payload?.otpRequired) {
    return {
      status: "otp_required",
      message: payload.message,
      expiresAt: payload.expiresAt,
      factorType: payload.factorType,
    };
  }

  const tokens = await resolveLoginTokens(payload, email);
  return {
    status: "success",
    ...tokens,
  };
};

export const apiAdminLogin = async (
  email: string,
  password: string
): Promise<LoginResp> => {
  if (MOCK) {
    await delay(500);
    return {
      accessToken: "mock.admin.access.token",
      refreshToken: "mock.admin.refresh.token",
      user: { ...mockUser, email },
    };
  }

  const payload = await api
    .post(API_ROUTES.auth.adminLogin, { email, password })
    .then((r) => unwrap<LoginPayload>(r.data));

  return resolveLoginTokens(payload, email);
};

export const apiLoginWithGoogle = async (): Promise<void> => {
  if (MOCK) {
    await delay(100);
    window.location.href = "/auth/google/complete#access=mock.google.access.token&refresh=mock.google.refresh.token";
    return;
  }
  window.location.href = AUTH_ENDPOINTS.google;
};

export const apiRequestPasswordReset = async (
  payload: ForgotPasswordPayload
): Promise<PasswordResetRequestResponse> => {
  if (MOCK) {
    await delay(500);
    return {
      otpRequired: true,
      message: "Password reset OTP sent to your email address",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  return api
    .post(API_ROUTES.auth.forgotPasswordRequest, payload)
    .then((r) => unwrap<PasswordResetRequestResponse>(r.data));
};

export const apiResetPassword = async (
  payload: ResetPasswordPayload
): Promise<PasswordResetConfirmResponse> => {
  if (MOCK) {
    await delay(500);
    return {
      reset: true,
      message: "Password reset successful",
    };
  }

  return api
    .post(API_ROUTES.auth.forgotPasswordReset, payload)
    .then((r) => unwrap<PasswordResetConfirmResponse>(r.data));
};

export async function apiMe(tokenOverride?: string): Promise<User> {
  if (MOCK) {
    await delay(200);
    return mockUser;
  }

  return api
    .get(API_ROUTES.auth.me, {
      headers: tokenOverride ? { Authorization: `Bearer ${tokenOverride}` } : undefined,
    })
    .then((r) => unwrap<User>(r.data));
}
