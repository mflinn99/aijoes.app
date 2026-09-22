/**
 * Identity provider abstraction — Directive §24, iteration 2 priority 1.
 *
 * The platform authenticates through this interface, never against a specific
 * provider. `LocalPasswordProvider` is implemented and is what runs today.
 * `OidcProvider` is configuration-driven and reports itself unconfigured until
 * an issuer is supplied, which is the honest state in an environment with no
 * IdP rather than a silent fallback to something weaker.
 */

export interface AuthenticatedIdentity {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  role: 'PLATFORM_ADMIN' | 'MSP_ADMIN' | 'MSP_USER' | 'READ_ONLY';
}

export type AuthOutcome =
  | { ok: true; identity: AuthenticatedIdentity }
  | { ok: false; reason: string; locked?: boolean };

export interface IdentityProvider {
  id: string;
  name: string;
  /** Does this provider have what it needs to authenticate anyone? */
  configured(): boolean;
  /** Only meaningful for interactive/redirect providers. */
  authorizationUrl?(state: string): string | null;
}

export class LocalPasswordProvider implements IdentityProvider {
  readonly id = 'local';
  readonly name = 'Email and password';
  configured(): boolean {
    return true;
  }
}

/**
 * SSO via OpenID Connect. The shape an MSP needs for staff sign-in.
 * Unconfigured until METAMSP_OIDC_ISSUER and a client id are present, at which
 * point the login screen offers it alongside local sign-in.
 */
export class OidcProvider implements IdentityProvider {
  readonly id = 'oidc';
  readonly name: string;

  constructor(
    private readonly issuer = process.env.METAMSP_OIDC_ISSUER,
    private readonly clientId = process.env.METAMSP_OIDC_CLIENT_ID,
    private readonly redirectUri = process.env.METAMSP_OIDC_REDIRECT_URI,
    displayName = process.env.METAMSP_OIDC_NAME,
  ) {
    this.name = displayName || 'Single sign-on';
  }

  configured(): boolean {
    return Boolean(this.issuer && this.clientId && this.redirectUri);
  }

  authorizationUrl(state: string): string | null {
    if (!this.configured()) return null;
    const url = new URL(`${this.issuer!.replace(/\/$/, '')}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId!);
    url.searchParams.set('redirect_uri', this.redirectUri!);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    return url.toString();
  }
}

const PROVIDERS: IdentityProvider[] = [new LocalPasswordProvider(), new OidcProvider()];

export function listProviders(): IdentityProvider[] {
  return PROVIDERS;
}

export function availableProviders(): IdentityProvider[] {
  return PROVIDERS.filter((p) => p.configured());
}
