/**
 * Appels d'authentification au backend Fuoco.
 *
 * Contrat backend (cf. `backend/config/packages/security.yaml` + `App\Entity\User`) :
 *   - POST /api/register    { email, password, displayName? }  → 201, renvoie le user (PAS de token)
 *   - POST /api/login       { email, password }                → { token, refresh_token }
 *   - POST /api/token/refresh { refresh_token }                → { token, refresh_token } (single-use)
 *
 * `/register` ne délivre pas de jeton : après inscription on enchaîne un `login` (voir AuthProvider).
 */
import { apiUrl } from './config';

/** Paire de jetons renvoyée par /login et /token/refresh. */
export type TokenPair = {
  token: string;
  refreshToken: string;
};

/** User renvoyé par /register (groupe de sérialisation `user:read`). */
export type RegisteredUser = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
};

/**
 * Erreur d'API porteuse du code HTTP et d'un message déjà *présentable à l'utilisateur* (FR).
 * `status = 0` = échec réseau (serveur injoignable), distingué des vraies réponses HTTP.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' } as const;

/** Enveloppe `fetch` : transforme une panne réseau en `ApiError(0)` au message parlant. */
async function postJson(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(apiUrl(path), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Impossible de joindre le serveur. Vérifie ta connexion.');
  }
}

/** Lit le corps JSON d'une réponse sans jamais throw (corps vide ou non-JSON → null). */
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Extrait un message d'erreur lisible d'un corps d'erreur API Platform / lexik. */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    // API Platform (validation) : violations détaillées champ par champ.
    if (Array.isArray(obj.violations) && obj.violations.length > 0) {
      const first = obj.violations[0] as { message?: unknown };
      if (typeof first.message === 'string' && first.message) {
        return first.message;
      }
    }
    // API Platform : `detail` ; lexik : `message`.
    if (typeof obj.detail === 'string' && obj.detail) {
      return obj.detail;
    }
    if (typeof obj.message === 'string' && obj.message) {
      return obj.message;
    }
  }
  return fallback;
}

/** POST /api/register puis renvoie le user créé. Lève `ApiError` (422 email déjà pris, etc.). */
export async function register(
  email: string,
  password: string,
  displayName?: string
): Promise<RegisteredUser> {
  const payload: Record<string, string> = { email, password };
  if (displayName?.trim()) {
    payload.displayName = displayName.trim();
  }
  const response = await postJson('/api/register', payload);
  const body = await safeJson(response);
  if (!response.ok) {
    throw new ApiError(response.status, extractErrorMessage(body, "Échec de l'inscription."));
  }
  return body as RegisteredUser;
}

/** POST /api/login. Lève `ApiError(401)` sur identifiants invalides, `(429)` sur throttling. */
export async function login(email: string, password: string): Promise<TokenPair> {
  const response = await postJson('/api/login', { email, password });
  const body = await safeJson(response);
  if (!response.ok) {
    const fallback =
      response.status === 401
        ? 'Email ou mot de passe incorrect.'
        : response.status === 429
          ? 'Trop de tentatives. Réessaie dans une minute.'
          : 'Échec de la connexion.';
    throw new ApiError(response.status, extractErrorMessage(body, fallback));
  }
  return readTokenPair(body);
}

/** POST /api/token/refresh. Lève `ApiError` si le refresh token est expiré/révoqué. */
export async function refresh(refreshToken: string): Promise<TokenPair> {
  const response = await postJson('/api/token/refresh', { refresh_token: refreshToken });
  const body = await safeJson(response);
  if (!response.ok) {
    throw new ApiError(response.status, extractErrorMessage(body, 'Session expirée.'));
  }
  return readTokenPair(body);
}

/** Normalise la réponse `{ token, refresh_token }` de lexik/gesdinet en `TokenPair`. */
function readTokenPair(body: unknown): TokenPair {
  const obj = (body ?? {}) as Record<string, unknown>;
  if (typeof obj.token !== 'string' || typeof obj.refresh_token !== 'string') {
    throw new ApiError(0, 'Réponse du serveur inattendue.');
  }
  return { token: obj.token, refreshToken: obj.refresh_token };
}
