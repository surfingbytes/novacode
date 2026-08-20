// node_modules
import {
  createHash,
  createPublicKey,
  randomBytes,
  type JsonWebKey as CryptoJsonWebKey,
  type KeyObject
} from 'node:crypto';
import jwt from 'jsonwebtoken';

// classes
import {
  isSecureRequest,
  parseCookieHeader
} from './sessionCookie';

export const OIDC_PENDING_COOKIE_NAME = 'nc_oidc';
export const OIDC_PENDING_MAX_AGE_SEC = 10 * 60;
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const JWT_CLOCK_TOLERANCE_SEC = 30;

const ASYMMETRIC_ALGS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512'
] as const;

type EnvMap = Record<string, string | undefined>;
type FetchFn = typeof fetch;

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string | null;
  appUrl: string | null;
  displayName: string;
  scopes: string;
}

export interface LoginMethodOptions {
  needsSetup: boolean;
  localLogin: boolean;
  oidcEnabled: boolean;
  oidcDisplayName: string;
}

export interface OidcPending {
  state: string;
  verifier: string;
  nonce: string;
  redirect: string;
  redirectUri: string;
}

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface CachedDiscovery {
  doc: DiscoveryDocument;
  fetchedAt: number;
}

const discoveryCache = new Map<string, CachedDiscovery>();

export function clearOidcDiscoveryCache(): void {
  discoveryCache.clear();
}

export function isLocalLoginEnabled(env: EnvMap = process.env): boolean {
  const raw = env['AUTH_LOCAL_LOGIN']?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  return true;
}

export function readOidcSettings(env: EnvMap = process.env): OidcSettings | null {
  const issuer = env['OIDC_ISSUER']?.trim();
  const clientId = env['OIDC_CLIENT_ID']?.trim();
  const clientSecret = env['OIDC_CLIENT_SECRET']?.trim();
  if (!issuer || !clientId || !clientSecret) {
    return null;
  }
  const redirectUri = env['OIDC_REDIRECT_URI']?.trim() || null;
  const appUrl = env['OIDC_APP_URL']?.trim() || null;
  const displayName = env['OIDC_DISPLAY_NAME']?.trim() || 'SSO';
  const scopes = env['OIDC_SCOPES']?.trim() || 'openid profile email';
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: redirectUri || null,
    appUrl: appUrl || null,
    displayName,
    scopes
  };
}

export function resolveLoginOptions(opts: {
  needsSetup: boolean;
  env?: EnvMap;
}): LoginMethodOptions {
  const env = opts.env ?? process.env;
  const oidc = readOidcSettings(env);
  if (opts.needsSetup) {
    return {
      needsSetup: true,
      localLogin: true,
      oidcEnabled: false,
      oidcDisplayName: oidc?.displayName ?? 'SSO'
    };
  }
  return {
    needsSetup: false,
    localLogin: isLocalLoginEnabled(env),
    oidcEnabled: oidc !== null,
    oidcDisplayName: oidc?.displayName ?? 'SSO'
  };
}

/** Relative in-app path only — blocks protocol-relative and absolute URLs. */
export function sanitizeAppRedirect(value: unknown): string {
  if (typeof value !== 'string') {
    return '/';
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) {
    return '/';
  }
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/';
  }
  if (trimmed.includes('://') || trimmed.includes('\\')) {
    return '/';
  }
  return trimmed;
}

export function publicRequestOrigin(input: {
  headers: Record<string, unknown>;
  protocol?: string;
  hostname?: string;
}): string {
  const proto = isSecureRequest(input.headers, input.protocol) ? 'https' : 'http';
  const forwardedHost = input.headers['x-forwarded-host'];
  const forwarded =
    typeof forwardedHost === 'string'
      ? forwardedHost.split(',')[0]?.trim()
      : Array.isArray(forwardedHost)
        ? String(forwardedHost[0] ?? '').split(',')[0]?.trim()
        : '';
  const hostHeader = input.headers.host;
  const hostFromHeader = typeof hostHeader === 'string' ? hostHeader.trim() : '';
  const host = forwarded || hostFromHeader || input.hostname || 'localhost';
  return `${proto}://${host}`;
}

export function resolveOidcCallbackUri(settings: OidcSettings, requestOrigin: string): string {
  if (settings.redirectUri) {
    return settings.redirectUri;
  }
  return `${requestOrigin.replace(/\/+$/, '')}/api/auth/oidc/callback`;
}

export function resolveOidcAppOrigin(settings: OidcSettings, callbackUri: string): string {
  if (settings.appUrl) {
    return settings.appUrl.replace(/\/+$/, '');
  }
  return new URL(callbackUri).origin;
}

export function oidcLoginPageUrl(
  appOrigin: string,
  query: { from?: string; error?: string; redirect?: string }
): string {
  const url = new URL('/login', `${appOrigin.replace(/\/+$/, '')}/`);
  if (query.from) {
    url.searchParams.set('from', query.from);
  }
  if (query.error) {
    url.searchParams.set('error', query.error);
  }
  if (query.redirect && query.redirect !== '/') {
    url.searchParams.set('redirect', query.redirect);
  }
  return url.toString();
}

function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function parseDiscovery(payload: unknown): Promise<DiscoveryDocument> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('OIDC discovery document is not an object');
  }
  const record = payload as Record<string, unknown>;
  const issuer = asNonEmptyString(record['issuer']);
  const authorizationEndpoint = asNonEmptyString(record['authorization_endpoint']);
  const tokenEndpoint = asNonEmptyString(record['token_endpoint']);
  const jwksUri = asNonEmptyString(record['jwks_uri']);
  if (!issuer || !authorizationEndpoint || !tokenEndpoint || !jwksUri) {
    throw new Error('OIDC discovery document is missing required endpoints');
  }
  return {
    issuer,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    jwks_uri: jwksUri
  };
}

export async function fetchOidcDiscovery(
  issuer: string,
  fetchFn: FetchFn = fetch
): Promise<DiscoveryDocument> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) {
    return cached.doc;
  }
  const response = await fetchFn(discoveryUrl(issuer), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`OIDC discovery failed (${response.status})`);
  }
  const doc = await parseDiscovery(await response.json());
  discoveryCache.set(issuer, { doc, fetchedAt: Date.now() });
  return doc;
}

function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createOidcPending(appRedirect: string, redirectUri: string): OidcPending {
  return {
    state: randomUrlToken(),
    verifier: randomUrlToken(),
    nonce: randomUrlToken(),
    redirect: sanitizeAppRedirect(appRedirect),
    redirectUri
  };
}

export function buildAuthorizationUrl(
  discovery: DiscoveryDocument,
  settings: OidcSettings,
  pending: OidcPending
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', pending.redirectUri);
  url.searchParams.set('scope', settings.scopes);
  url.searchParams.set('state', pending.state);
  url.searchParams.set('nonce', pending.nonce);
  url.searchParams.set('code_challenge', pkceChallenge(pending.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function beginOidcAuthorization(
  settings: OidcSettings,
  opts: { appRedirect: string; callbackUri: string; fetchFn?: FetchFn }
): Promise<{ authorizationUrl: string; pending: OidcPending }> {
  const discovery = await fetchOidcDiscovery(settings.issuer, opts.fetchFn ?? fetch);
  const pending = createOidcPending(opts.appRedirect, opts.callbackUri);
  return {
    authorizationUrl: buildAuthorizationUrl(discovery, settings, pending),
    pending
  };
}

function cookieHeader(name: string, value: string, opts: { secure: boolean; maxAgeSec: number }): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${opts.maxAgeSec}`
  ];
  if (opts.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function oidcPendingCookieHeader(token: string, opts: { secure: boolean }): string {
  return cookieHeader(OIDC_PENDING_COOKIE_NAME, token, {
    secure: opts.secure,
    maxAgeSec: OIDC_PENDING_MAX_AGE_SEC
  });
}

export function clearOidcPendingCookieHeader(secure: boolean): string {
  return cookieHeader(OIDC_PENDING_COOKIE_NAME, '', { secure, maxAgeSec: 0 });
}

function jwtSecret(): string {
  const secret = (process.env['JWT_SECRET'] ?? '').trim();
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

export function signOidcPending(pending: OidcPending): string {
  return jwt.sign({ ...pending, purpose: 'oidc' }, jwtSecret(), {
    expiresIn: OIDC_PENDING_MAX_AGE_SEC
  });
}

export function readOidcPending(cookieHeaderValue: string | undefined): OidcPending | null {
  const token = parseCookieHeader(cookieHeaderValue)[OIDC_PENDING_COOKIE_NAME];
  if (!token) {
    return null;
  }
  try {
    const payload = jwt.verify(token, jwtSecret()) as Partial<OidcPending> & {
      purpose?: string;
    };
    if (payload.purpose !== 'oidc') {
      return null;
    }
    if (
      !payload.state ||
      !payload.verifier ||
      !payload.nonce ||
      !payload.redirect ||
      !payload.redirectUri
    ) {
      return null;
    }
    return {
      state: payload.state,
      verifier: payload.verifier,
      nonce: payload.nonce,
      redirect: sanitizeAppRedirect(payload.redirect),
      redirectUri: payload.redirectUri
    };
  } catch {
    return null;
  }
}

interface JwksKey {
  kid?: string;
  kty?: string;
  [key: string]: unknown;
}

async function fetchJwks(jwksUri: string, fetchFn: FetchFn): Promise<JwksKey[]> {
  const response = await fetchFn(jwksUri, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`OIDC JWKS fetch failed (${response.status})`);
  }
  const payload = (await response.json()) as { keys?: JwksKey[] };
  if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
    throw new Error('OIDC JWKS document has no keys');
  }
  return payload.keys;
}

function signingKeyForHeader(
  header: jwt.JwtHeader,
  settings: OidcSettings,
  keys: JwksKey[]
): jwt.Secret | KeyObject {
  const alg = header.alg ?? '';
  if (alg.startsWith('HS')) {
    return settings.clientSecret;
  }
  const jwk = header.kid ? keys.find((key) => key.kid === header.kid) : keys[0];
  if (!jwk) {
    throw new Error('No matching JWKS key for id_token');
  }
  return createPublicKey({ key: jwk as unknown as CryptoJsonWebKey, format: 'jwk' });
}

function audienceMatches(aud: unknown, clientId: string): boolean {
  if (typeof aud === 'string') {
    return aud === clientId;
  }
  if (Array.isArray(aud)) {
    return aud.includes(clientId);
  }
  return false;
}

function issuersMatch(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string') {
    return false;
  }
  return expected.replace(/\/+$/, '') === actual.replace(/\/+$/, '');
}

async function verifyIdToken(
  idToken: string,
  opts: {
    settings: OidcSettings;
    discovery: DiscoveryDocument;
    nonce: string;
    fetchFn: FetchFn;
  }
): Promise<void> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new Error('id_token is not a JWT');
  }
  const alg = decoded.header.alg ?? '';
  const allowed = alg.startsWith('HS')
    ? (['HS256', 'HS384', 'HS512'] as const)
    : ASYMMETRIC_ALGS;
  if (!(allowed as readonly string[]).includes(alg)) {
    throw new Error(`Unsupported id_token algorithm ${alg}`);
  }
  const keys = alg.startsWith('HS') ? [] : await fetchJwks(opts.discovery.jwks_uri, opts.fetchFn);
  const key = signingKeyForHeader(decoded.header, opts.settings, keys);
  const payload = jwt.verify(idToken, key, {
    algorithms: [...allowed],
    clockTolerance: JWT_CLOCK_TOLERANCE_SEC
  }) as jwt.JwtPayload;
  if (!issuersMatch(opts.discovery.issuer, payload.iss)) {
    throw new Error('id_token issuer mismatch');
  }
  if (!audienceMatches(payload.aud, opts.settings.clientId)) {
    throw new Error('id_token audience mismatch');
  }
  if (payload.nonce !== opts.nonce) {
    throw new Error('id_token nonce mismatch');
  }
}

export async function completeOidcAuthorization(
  settings: OidcSettings,
  pending: OidcPending,
  callbackUrl: URL,
  fetchFn: FetchFn = fetch
): Promise<{ ok: true } | { ok: false; error: 'oidc' | 'oidc_denied' }> {
  const idpError = callbackUrl.searchParams.get('error');
  if (idpError) {
    return { ok: false, error: idpError === 'access_denied' ? 'oidc_denied' : 'oidc' };
  }
  const code = callbackUrl.searchParams.get('code');
  const state = callbackUrl.searchParams.get('state');
  if (!code || !state || state !== pending.state) {
    return { ok: false, error: 'oidc' };
  }
  try {
    const discovery = await fetchOidcDiscovery(settings.issuer, fetchFn);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code_verifier: pending.verifier
    });
    const tokenResponse = await fetchFn(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!tokenResponse.ok) {
      return { ok: false, error: 'oidc' };
    }
    const tokenPayload = (await tokenResponse.json()) as { id_token?: unknown };
    const idToken = asNonEmptyString(tokenPayload.id_token);
    if (!idToken) {
      return { ok: false, error: 'oidc' };
    }
    await verifyIdToken(idToken, {
      settings,
      discovery,
      nonce: pending.nonce,
      fetchFn
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'oidc' };
  }
}
