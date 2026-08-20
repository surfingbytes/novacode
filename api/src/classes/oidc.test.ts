import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginOidcAuthorization,
  buildAuthorizationUrl,
  clearOidcDiscoveryCache,
  completeOidcAuthorization,
  createOidcPending,
  isLocalLoginEnabled,
  oidcLoginPageUrl,
  publicRequestOrigin,
  readOidcPending,
  readOidcSettings,
  resolveLoginOptions,
  resolveOidcAppOrigin,
  resolveOidcCallbackUri,
  sanitizeAppRedirect,
  signOidcPending,
  type OidcSettings
} from './oidc';

const SETTINGS: OidcSettings = {
  issuer: 'https://auth.example.com/application/o/novacode/',
  clientId: 'novacode',
  clientSecret: 's3cret',
  redirectUri: 'https://nova.example.com/api/auth/oidc/callback',
  appUrl: null,
  displayName: 'Authentik',
  scopes: 'openid profile email'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('OIDC login settings', () => {
  it('treats local login as enabled unless explicitly disabled', () => {
    expect(isLocalLoginEnabled({})).toBe(true);
    expect(isLocalLoginEnabled({ AUTH_LOCAL_LOGIN: 'true' })).toBe(true);
    expect(isLocalLoginEnabled({ AUTH_LOCAL_LOGIN: 'false' })).toBe(false);
    expect(isLocalLoginEnabled({ AUTH_LOCAL_LOGIN: '0' })).toBe(false);
  });

  it('enables OIDC only when issuer, client id, and secret are set', () => {
    expect(readOidcSettings({})).toBeNull();
    expect(
      readOidcSettings({
        OIDC_ISSUER: SETTINGS.issuer,
        OIDC_CLIENT_ID: SETTINGS.clientId
      })
    ).toBeNull();
    expect(
      readOidcSettings({
        OIDC_ISSUER: SETTINGS.issuer,
        OIDC_CLIENT_ID: SETTINGS.clientId,
        OIDC_CLIENT_SECRET: SETTINGS.clientSecret,
        OIDC_DISPLAY_NAME: 'Authentik'
      })
    ).toEqual({
      issuer: SETTINGS.issuer,
      clientId: SETTINGS.clientId,
      clientSecret: SETTINGS.clientSecret,
      redirectUri: null,
      appUrl: null,
      displayName: 'Authentik',
      scopes: 'openid profile email'
    });
  });

  it('forces local login during first-run setup and hides OIDC', () => {
    const env = {
      AUTH_LOCAL_LOGIN: 'false',
      OIDC_ISSUER: SETTINGS.issuer,
      OIDC_CLIENT_ID: SETTINGS.clientId,
      OIDC_CLIENT_SECRET: SETTINGS.clientSecret
    };
    expect(resolveLoginOptions({ needsSetup: true, env })).toEqual({
      needsSetup: true,
      localLogin: true,
      oidcEnabled: false,
      oidcDisplayName: 'SSO'
    });
    expect(resolveLoginOptions({ needsSetup: false, env })).toEqual({
      needsSetup: false,
      localLogin: false,
      oidcEnabled: true,
      oidcDisplayName: 'SSO'
    });
  });
});

describe('OIDC redirect helpers', () => {
  it('rejects open redirects', () => {
    expect(sanitizeAppRedirect('/workspace/1')).toBe('/workspace/1');
    expect(sanitizeAppRedirect('https://evil.example')).toBe('/');
    expect(sanitizeAppRedirect('//evil.example')).toBe('/');
    expect(sanitizeAppRedirect('/\\evil')).toBe('/');
  });

  it('prefers forwarded host and proto', () => {
    expect(
      publicRequestOrigin({
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'nova.example.com',
          host: 'localhost:3030'
        },
        protocol: 'http'
      })
    ).toBe('https://nova.example.com');
  });

  it('builds callback and app origins from settings', () => {
    expect(resolveOidcCallbackUri(SETTINGS, 'http://localhost:3030')).toBe(SETTINGS.redirectUri);
    expect(resolveOidcCallbackUri({ ...SETTINGS, redirectUri: null }, 'https://nova.example.com')).toBe(
      'https://nova.example.com/api/auth/oidc/callback'
    );
    expect(resolveOidcAppOrigin(SETTINGS, SETTINGS.redirectUri!)).toBe('https://nova.example.com');
    expect(
      oidcLoginPageUrl('https://nova.example.com', { from: 'oidc', redirect: '/home' })
    ).toBe('https://nova.example.com/login?from=oidc&redirect=%2Fhome');
  });
});

describe('OIDC pending cookie', () => {
  beforeEach(() => {
    process.env['JWT_SECRET'] = 'test-oidc-secret-not-the-example';
  });

  it('round-trips state for the callback', () => {
    const pending = createOidcPending('/workspace/abc', SETTINGS.redirectUri!);
    const token = signOidcPending(pending);
    expect(readOidcPending(`nc_oidc=${encodeURIComponent(token)}`)).toEqual(pending);
  });
});

describe('OIDC authorization', () => {
  beforeEach(() => {
    clearOidcDiscoveryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the discovery authorization endpoint and PKCE', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe(
        'https://auth.example.com/application/o/novacode/.well-known/openid-configuration'
      );
      return jsonResponse({
        issuer: 'https://auth.example.com/application/o/novacode',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        jwks_uri: 'https://auth.example.com/jwks'
      });
    });
    const { authorizationUrl, pending } = await beginOidcAuthorization(SETTINGS, {
      appRedirect: '/workspace/1',
      callbackUri: SETTINGS.redirectUri!,
      fetchFn: fetchFn as unknown as typeof fetch
    });
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://auth.example.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('novacode');
    expect(url.searchParams.get('redirect_uri')).toBe(SETTINGS.redirectUri);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe(pending.state);
    expect(url.searchParams.get('nonce')).toBe(pending.nonce);
  });

  it('exchanges the code and verifies the id_token', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: 'jwk' });
    const pending = createOidcPending('/', SETTINGS.redirectUri!);
    const now = Math.floor(Date.now() / 1000);
    const idToken = jwt.sign(
      {
        iss: 'https://auth.example.com/application/o/novacode',
        aud: 'novacode',
        nonce: pending.nonce,
        sub: 'user-1',
        iat: now,
        exp: now + 300
      },
      privateKey,
      { algorithm: 'RS256', keyid: 'kid-1' }
    );

    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('openid-configuration')) {
        return jsonResponse({
          issuer: 'https://auth.example.com/application/o/novacode',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          jwks_uri: 'https://auth.example.com/jwks'
        });
      }
      if (url.endsWith('/token')) {
        expect(init?.method).toBe('POST');
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('code')).toBe('abc');
        expect(body.get('code_verifier')).toBe(pending.verifier);
        expect(body.get('redirect_uri')).toBe(SETTINGS.redirectUri);
        return jsonResponse({ id_token: idToken });
      }
      if (url.endsWith('/jwks')) {
        return jsonResponse({ keys: [{ ...publicJwk, kid: 'kid-1' }] });
      }
      return jsonResponse({}, 404);
    });

    const callbackUrl = new URL(SETTINGS.redirectUri!);
    callbackUrl.searchParams.set('code', 'abc');
    callbackUrl.searchParams.set('state', pending.state);

    const result = await completeOidcAuthorization(
      SETTINGS,
      pending,
      callbackUrl,
      fetchFn as unknown as typeof fetch
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects a nonce mismatch', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: 'jwk' });
    const pending = createOidcPending('/', SETTINGS.redirectUri!);
    const now = Math.floor(Date.now() / 1000);
    const idToken = jwt.sign(
      {
        iss: 'https://auth.example.com/application/o/novacode',
        aud: 'novacode',
        nonce: 'wrong-nonce',
        sub: 'user-1',
        iat: now,
        exp: now + 300
      },
      privateKey,
      { algorithm: 'RS256', keyid: 'kid-1' }
    );

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('openid-configuration')) {
        return jsonResponse({
          issuer: 'https://auth.example.com/application/o/novacode',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          jwks_uri: 'https://auth.example.com/jwks'
        });
      }
      if (url.endsWith('/token')) {
        return jsonResponse({ id_token: idToken });
      }
      return jsonResponse({ keys: [{ ...publicJwk, kid: 'kid-1' }] });
    });

    const callbackUrl = new URL(SETTINGS.redirectUri!);
    callbackUrl.searchParams.set('code', 'abc');
    callbackUrl.searchParams.set('state', pending.state);

    const result = await completeOidcAuthorization(
      SETTINGS,
      pending,
      callbackUrl,
      fetchFn as unknown as typeof fetch
    );
    expect(result).toEqual({ ok: false, error: 'oidc' });
  });

  it('maps IdP access_denied to oidc_denied', async () => {
    const pending = createOidcPending('/', SETTINGS.redirectUri!);
    const callbackUrl = new URL(SETTINGS.redirectUri!);
    callbackUrl.searchParams.set('error', 'access_denied');
    callbackUrl.searchParams.set('state', pending.state);
    const result = await completeOidcAuthorization(SETTINGS, pending, callbackUrl);
    expect(result).toEqual({ ok: false, error: 'oidc_denied' });
  });

  it('includes PKCE on a pre-built authorization URL', () => {
    const pending = createOidcPending('/', SETTINGS.redirectUri!);
    const url = new URL(
      buildAuthorizationUrl(
        {
          issuer: SETTINGS.issuer,
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          jwks_uri: 'https://auth.example.com/jwks'
        },
        SETTINGS,
        pending
      )
    );
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});
