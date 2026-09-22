/**
 * Microsoft Graph client.
 *
 * App-only (client credentials) against a customer tenant, which is how an MSP
 * holds delegated access. Token caching is per tenant+client so a sync does not
 * re-authenticate for every page of results.
 *
 * `transport` is injectable so the connector can be tested against recorded
 * Graph responses without a live tenant or a network call.
 */

export interface GraphCredentials {
  /** The customer's Entra tenant id. */
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface GraphTransport {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  }>;
}

const defaultTransport: GraphTransport = (url, init) =>
  fetch(url, init) as unknown as ReturnType<GraphTransport>;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export class GraphClient {
  constructor(
    private readonly credentials: GraphCredentials,
    private readonly transport: GraphTransport = defaultTransport,
  ) {}

  private cacheKey(): string {
    return `${this.credentials.tenantId}:${this.credentials.clientId}`;
  }

  async accessToken(): Promise<string> {
    const cached = tokenCache.get(this.cacheKey());
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const res = await this.transport(
      `https://login.microsoftonline.com/${encodeURIComponent(this.credentials.tenantId)}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() },
    );

    if (!res.ok) {
      // The response body can echo the client secret back; never include it.
      throw new GraphError(`Microsoft token request failed (${res.status}).`, res.status);
    }

    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new GraphError('Microsoft token response contained no access token.', 500);

    tokenCache.set(this.cacheKey(), {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    });
    return json.access_token;
  }

  /** GET a Graph path, following @odata.nextLink to the end. */
  async getAll<T>(path: string, maxPages = 20): Promise<T[]> {
    const token = await this.accessToken();
    let url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
    const out: T[] = [];

    for (let page = 0; page < maxPages; page++) {
      const res = await this.transport(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      });

      if (!res.ok) {
        throw new GraphError(`Microsoft Graph request to ${new URL(url).pathname} failed (${res.status}).`, res.status);
      }

      const json = (await res.json()) as { value?: T[]; '@odata.nextLink'?: string };
      if (Array.isArray(json.value)) out.push(...json.value);
      if (!json['@odata.nextLink']) break;
      url = json['@odata.nextLink'];
    }

    return out;
  }

  async getOne<T>(path: string): Promise<T> {
    const token = await this.accessToken();
    const res = await this.transport(`https://graph.microsoft.com/v1.0${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!res.ok) throw new GraphError(`Microsoft Graph request to ${path} failed (${res.status}).`, res.status);
    return (await res.json()) as T;
  }
}

export function clearTokenCache(): void {
  tokenCache.clear();
}
