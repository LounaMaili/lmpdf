const runtimeDefaultApiUrl = (() => {
  if (typeof window === 'undefined') return 'http://localhost:3000/api';
  return `${window.location.protocol}//${window.location.hostname}:3000/api`;
})();

const API_URL = import.meta.env.VITE_API_URL ?? runtimeDefaultApiUrl;

const TOKEN_KEY = 'lmpdf_token';
const USER_KEY = 'lmpdf_user';
const AUTH_FETCH_TIMEOUT_MS = 5000;

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  authSource?: 'local' | 'ldap';
  externalId?: string | null;
  mfaEnabled?: boolean;
  hasWebauthn?: boolean;
  mfaPolicy?: 'disabled' | 'optional' | 'required';
};

export type LoginResult = {
  token?: string;
  user?: AuthUser;
  mfaRequired?: boolean;
  mfaChallengeToken?: string;
  webauthnOptions?: any;
  mfaSetupRequired?: boolean;
};

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = AUTH_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetchWithTimeout(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Identifiants invalides');
  }
  return res.json();
}

export async function loginMfaVerify(mfaChallengeToken: string, code: string): Promise<LoginResult> {
  const res = await fetchWithTimeout(`${API_URL}/auth/login/mfa-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfaChallengeToken, code }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Vérification MFA échouée');
  }
  return res.json();
}

export async function loginWebauthnVerify(mfaChallengeToken: string, response: any): Promise<LoginResult> {
  const res = await fetchWithTimeout(`${API_URL}/auth/login/webauthn-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfaChallengeToken, response }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Vérification WebAuthn échouée');
  }
  return res.json();
}

// ─── V3: Passwordless WebAuthn Login ─────────────────────────────────────

export async function loginPasswordlessBegin(email: string): Promise<{ options: any }> {
  const res = await fetchWithTimeout(`${API_URL}/auth/login/passwordless-begin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Connexion par passkey non disponible');
  }
  return res.json();
}

export async function loginPasswordlessFinish(email: string, response: any): Promise<LoginResult> {
  const res = await fetchWithTimeout(`${API_URL}/auth/login/passwordless-finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, response }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Connexion par passkey non disponible');
  }
  return res.json();
}

export async function register(email: string, password: string, displayName: string): Promise<{ token: string; user: AuthUser }> {
  const res = await fetchWithTimeout(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Erreur inscription');
  }
  return res.json();
}

export async function fetchMe(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetchWithTimeout(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      clearAuth();
      return null;
    }
    return res.json();
  } catch {
    clearAuth();
    return null;
  }
}
