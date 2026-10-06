// Microsoft Entra ID bearer tokens, for callers such as Microsoft 365 Copilot.
//
// Copilot obtains a delegated token for the signed-in user through the
// Microsoft Enterprise token store (Entra SSO auth config). We verify the
// signature against the tenant's keys, the issuer and tenant, the audience
// (our API, including the auth config's Application ID URI), the client that
// requested it, and the delegated scope.

import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

/** Client ID of the Microsoft Enterprise token store that Copilot uses for Entra SSO. */
export const TOKEN_STORE_CLIENT_ID = "ab3be6b7-f5df-413d-ac2d-abf1e3fd9c0b";

export interface EntraConfig {
  tenantId: string;
  /** Accepted `aud` values: the API's client ID / App ID URI and the SSO auth config's Application ID URI. */
  audiences: string[];
  /** Delegated scope the token must carry, e.g. access_as_user. */
  requiredScope: string;
  /** Clients allowed to request tokens (azp/appid). Defaults to the Enterprise token store. */
  allowedClientIds: string[];
}

export interface EntraIdentity {
  email: string;
  name: string | null;
  objectId: string | null;
}

export class EntraAuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

export type EntraVerifier = (token: string) => Promise<EntraIdentity>;

export function entraConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EntraConfig | null {
  const tenantId = env.HIJOJO_ENTRA_TENANT_ID;
  const audiences = (env.HIJOJO_ENTRA_AUDIENCES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!tenantId || audiences.length === 0) return null;
  const extra = (env.HIJOJO_ENTRA_ALLOWED_CLIENT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    tenantId,
    audiences,
    requiredScope: env.HIJOJO_ENTRA_SCOPE || "access_as_user",
    allowedClientIds: [TOKEN_STORE_CLIENT_ID, ...extra],
  };
}

export function createEntraVerifier(cfg: EntraConfig, keys?: JWTVerifyGetKey): EntraVerifier {
  const keySet = keys ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${cfg.tenantId}/discovery/v2.0/keys`));
  const issuers = [`https://login.microsoftonline.com/${cfg.tenantId}/v2.0`, `https://sts.windows.net/${cfg.tenantId}/`];
  return async (token: string) => {
    let payload: Record<string, any>;
    try {
      ({ payload } = await jwtVerify(token, keySet, { issuer: issuers, audience: cfg.audiences, algorithms: ["RS256"], clockTolerance: 60 }));
    } catch (e) {
      const why = e instanceof errors.JWTExpired ? "expired" : e instanceof errors.JWTClaimValidationFailed ? `invalid ${e.claim}` : "invalid signature or format";
      throw new EntraAuthError(401, `Token rejected: ${why}`);
    }
    if (payload.tid !== cfg.tenantId) throw new EntraAuthError(401, "Token rejected: wrong tenant");
    const client = payload.azp ?? payload.appid;
    if (!cfg.allowedClientIds.includes(client)) throw new EntraAuthError(401, "Token rejected: client not allowed");
    const scopes = String(payload.scp ?? "").split(" ");
    if (!scopes.includes(cfg.requiredScope)) throw new EntraAuthError(403, `Token lacks the ${cfg.requiredScope} scope`);
    const email = String(payload.preferred_username ?? payload.upn ?? payload.email ?? "").toLowerCase();
    if (!email) throw new EntraAuthError(401, "Token carries no user name");
    return { email, name: payload.name ?? null, objectId: payload.oid ?? null };
  };
}
