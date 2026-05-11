import api from "../../../app/axios";
import { ACCOUNT_ENDPOINTS, API_BASE_URL } from "../../../app/apiRoutes";
import { isAxiosError } from "axios";

export type DeleteAccountResponse = { deleted: boolean };

export type UserProfile = {
  userId: number;
  displayName: string;
  country: string;
  tier?: string | null;
  two_factor_enabled?: boolean;
  google_auth_enabled?: boolean;
  google_auth_configured?: boolean;
  first_name: string;
  last_name: string;
  username: string;
  mobile_number: string;
  state: string;
  city: string;
  postal_code: string;
  date_of_birth: string | null;
  gender: string;
  address_line_1: string;
  address_line_2: string;
  default_withdraw_wallet_address: string;
  default_withdraw_wallet_network: string;
  profile_photo: string | null;
  lastLogin?: string | null;
};

export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
};

export type TwoFactorSetupResponse = {
  secret: string;
  qrCode: string;
  otpauthUrl: string;
  issuer: string;
  accountLabel: string;
};

type WrappedResponse<T> = {
  status?: boolean;
  code?: number;
  message?: string;
  data?: T;
};

const unwrap = <T,>(payload: T | WrappedResponse<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload && payload.data !== undefined) {
    return payload.data;
  }
  return payload as T;
};

const toAbsoluteAssetUrl = (value: string | null | undefined) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")) {
    return value;
  }
  return `${API_BASE_URL}${value.startsWith("/") ? value : `/${value}`}`;
};

const extractErrorMessage = (err: unknown, fallback: string) => {
  if (isAxiosError(err)) {
    const data = err.response?.data;
    if (data && typeof data === "object") {
      if (typeof (data as { message?: unknown }).message === "string") {
        return (data as { message: string }).message;
      }
      if (typeof (data as { error?: unknown }).error === "string") {
        return (data as { error: string }).error;
      }
    }
    if (typeof data === "string") return data;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return fallback;
};

export async function getUserProfile(): Promise<UserProfile> {
  const { data } = await api.get<UserProfile | WrappedResponse<UserProfile>>(ACCOUNT_ENDPOINTS.profile);
  const profile = unwrap(data);
  return {
    ...profile,
    profile_photo: toAbsoluteAssetUrl(profile.profile_photo),
  };
}

export async function updateUserProfile(
  payload: Partial<Omit<UserProfile, "date_of_birth" | "gender" | "profile_photo">> & {
    personalInformation?: boolean;
    date_of_birth?: string | null;
    gender?: string | null;
    profile_photo?: string | File | null;
  }
) {
  try {
    // If profile_photo is a File, use FormData
    if (payload.profile_photo instanceof File) {
      const formData = new FormData();

      Object.entries(payload).forEach(([key, value]) => {
        if (key === "profile_photo") {
          formData.append(key, value as File);
        } else if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      });

      const { data } = await api.patch<UserProfile | WrappedResponse<UserProfile>>(
        ACCOUNT_ENDPOINTS.profile,
        formData,
      );
      return unwrap(data);
    }

    const { data } = await api.patch<UserProfile | WrappedResponse<UserProfile>>(ACCOUNT_ENDPOINTS.profile, payload);
    return unwrap(data);
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Unable to save personal information."));
  }
}

export async function changeUserPassword(payload: ChangePasswordPayload) {
  try {
    const { data } = await api.post<{ changed: boolean } | WrappedResponse<{ changed: boolean }>>(
      ACCOUNT_ENDPOINTS.password,
      payload
    );
    return unwrap(data);
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Unable to change password."));
  }
}

export async function setupGoogleAuthenticator() {
  try {
    const { data } = await api.post<TwoFactorSetupResponse | WrappedResponse<TwoFactorSetupResponse>>(
      ACCOUNT_ENDPOINTS.twoFactorSetup
    );
    return unwrap(data);
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Unable to start Google Authenticator setup."));
  }
}

export async function enableGoogleAuthenticator(code: string) {
  try {
    const { data } = await api.post<UserProfile | WrappedResponse<UserProfile>>(ACCOUNT_ENDPOINTS.twoFactorEnable, { code });
    return unwrap(data);
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Unable to enable Google Authenticator."));
  }
}

export async function disableGoogleAuthenticator(code: string) {
  try {
    const { data } = await api.post<UserProfile | WrappedResponse<UserProfile>>(ACCOUNT_ENDPOINTS.twoFactorDisable, { code });
    return unwrap(data);
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Unable to disable Google Authenticator."));
  }
}

export async function deleteAccount(): Promise<DeleteAccountResponse> {
  const { data } = await api.delete<DeleteAccountResponse | WrappedResponse<DeleteAccountResponse>>(
    ACCOUNT_ENDPOINTS.delete
  );
  return unwrap(data);
}
