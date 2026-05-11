export type User = {
  id: number;
  name: string;
  displayName?: string;
  email: string;
  currentLevelCode?: string | null;
  currentLevelRank?: number | null;
  twoFactorEnabled?: boolean;
  kycStatus?: "pending" | "approved" | "rejected";
  country?: string;
  roles?: string[];
  permissions?: string[];
};

export type LoginResp = {
  accessToken: string;
  refreshToken: string;
  user: User;
};

export type LoginChallenge = {
  status: "otp_required";
  message?: string;
  expiresAt?: string | null;
  factorType?: "email" | "authenticator";
};

export type LoginSuccess = LoginResp & {
  status: "success";
};

export type LoginResponse = LoginChallenge | LoginSuccess;

export type PasswordResetRequestResponse = {
  otpRequired: true;
  message?: string;
  expiresAt?: string;
};

export type PasswordResetConfirmResponse = {
  reset: true;
  message: string;
};
