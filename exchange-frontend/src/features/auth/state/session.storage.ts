const ACCESS_TOKEN_KEY = "accessToken";
const REFRESH_TOKEN_KEY = "refreshToken";

function hasWindow() {
  return typeof window !== "undefined";
}

function readFromStorages(key: string) {
  if (!hasWindow()) return null;
  return window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
}

export function getStoredAccessToken() {
  return readFromStorages(ACCESS_TOKEN_KEY);
}

export function getStoredRefreshToken() {
  return readFromStorages(REFRESH_TOKEN_KEY);
}

export function setUserSessionTokens({
  accessToken,
  refreshToken,
  remember,
}: {
  accessToken: string;
  refreshToken?: string;
  remember: boolean;
}) {
  if (!hasWindow()) return;

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);

  const storage = remember ? window.localStorage : window.sessionStorage;
  storage.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    storage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

export function clearUserSessionTokens() {
  if (!hasWindow()) return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}
