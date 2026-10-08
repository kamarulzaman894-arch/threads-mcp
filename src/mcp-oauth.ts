import * as http from 'http';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { URL } from 'url';

export type OAuthStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
};

type OAuthClient = {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  createdAt: number;
};

type OAuthTxn = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scope: string;
  resource: string;
  createdAt: number;
};

type OAuthCode = OAuthTxn & {
  userId: string;
};

type OAuthTokenRecord = {
  clientId: string;
  userId: string;
  scope: string;
  resource: string;
  expiresAt: number;
};

export type McpOAuthConfig = {
  baseUrl: string;
  resourceUrl: string;
  scope: string;
  store: OAuthStore;
  getConnectedUserId: () => string | null;
  ownerKeyHash: string;
};

const CLIENT_PREFIX = 'kz:mcp:oauth:client:';
const TXN_PREFIX = 'kz:mcp:oauth:txn:';
const CODE_PREFIX = 'kz:mcp:oauth:code:';
const ACCESS_PREFIX = 'kz:mcp:oauth:access:';
const REFRESH_PREFIX = 'kz:mcp:oauth:refresh:';

const CLIENT_TTL_SECONDS = 180 * 24 * 60 * 60;
const TXN_TTL_SECONDS = 10 * 60;
const CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function pkceS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendHtml(
  res: http.ServerResponse,
  status: number,
  body: string
): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1024 * 1024) {
      throw new Error('Request body too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isAllowedRedirect(value: string): boolean {
  try {
    const target = new URL(value);
    if (target.protocol !== 'https:') return false;
    return (
      target.hostname === 'chatgpt.com' ||
      target.hostname.endsWith('.chatgpt.com') ||
      target.hostname === 'openai.com' ||
      target.hostname.endsWith('.openai.com')
    );
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class McpOAuthServer {
  private readonly baseUrl: string;
  private readonly resourceUrl: string;
  private readonly scope: string;
  private readonly store: OAuthStore;
  private readonly getConnectedUserId: () => string | null;
  private readonly ownerKeyHash: string;

  constructor(config: McpOAuthConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.resourceUrl = config.resourceUrl;
    this.scope = config.scope;
    this.store = config.store;
    this.getConnectedUserId = config.getConnectedUserId;
    this.ownerKeyHash = config.ownerKeyHash;
  }

  protectedResourceMetadata() {
    return {
      resource: this.resourceUrl,
      authorization_servers: [this.baseUrl],
      scopes_supported: [this.scope],
      bearer_methods_supported: ['header'],
    };
  }

  authorizationServerMetadata() {
    return {
      issuer: this.baseUrl,
      authorization_endpoint: this.baseUrl + '/oauth/authorize',
      token_endpoint: this.baseUrl + '/oauth/token',
      registration_endpoint: this.baseUrl + '/oauth/register',
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [this.scope],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
    };
  }

  async register(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}') as {
      redirect_uris?: string[];
      client_name?: string;
    };

    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((item) => typeof item === 'string')
      : [];

    if (
      redirectUris.length === 0 ||
      redirectUris.some((uri) => !isAllowedRedirect(uri))
    ) {
      return sendJson(res, 400, { error: 'invalid_redirect_uri' });
    }

    const clientId = 'kzchatgpt_' + randomToken();
    const client: OAuthClient = {
      clientId,
      redirectUris,
      clientName:
        typeof body.client_name === 'string'
          ? body.client_name.slice(0, 120)
          : undefined,
      createdAt: Date.now(),
    };

    const saved = await this.store.set(
      CLIENT_PREFIX + clientId,
      JSON.stringify(client),
      CLIENT_TTL_SECONDS
    );
    if (!saved) {
      return sendJson(res, 503, { error: 'temporarily_unavailable' });
    }

    return sendJson(res, 201, {
      client_id: clientId,
      redirect_uris: redirectUris,
      client_name: client.clientName,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: this.scope,
    });
  }

  async authorize(url: URL, res: http.ServerResponse): Promise<void> {
    const connectedUserId = this.getConnectedUserId();
    if (!connectedUserId) {
      return sendHtml(
        res,
        503,
        '<h1>Threads account is not connected.</h1>'
      );
    }

    const clientId = url.searchParams.get('client_id') || '';
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const responseType = url.searchParams.get('response_type') || '';
    const codeChallenge = url.searchParams.get('code_challenge') || '';
    const codeChallengeMethod =
      url.searchParams.get('code_challenge_method') || '';
    const resource = url.searchParams.get('resource') || this.resourceUrl;
    const requestedScope =
      url.searchParams.get('scope') || this.scope;
    const state = url.searchParams.get('state') || undefined;

    const rawClient = await this.store.get(CLIENT_PREFIX + clientId);
    const client = rawClient
      ? (JSON.parse(rawClient) as OAuthClient)
      : null;

    if (
      !client ||
      !client.redirectUris.includes(redirectUri) ||
      responseType !== 'code' ||
      !codeChallenge ||
      codeChallengeMethod !== 'S256' ||
      resource !== this.resourceUrl ||
      !requestedScope.split(/\s+/).includes(this.scope)
    ) {
      return sendHtml(res, 400, '<h1>Invalid authorization request.</h1>');
    }

    const txnId = randomToken();
    const txn: OAuthTxn = {
      clientId,
      redirectUri,
      codeChallenge,
      state,
      scope: this.scope,
      resource: this.resourceUrl,
      createdAt: Date.now(),
    };

    const saved = await this.store.set(
      TXN_PREFIX + txnId,
      JSON.stringify(txn),
      TXN_TTL_SECONDS
    );
    if (!saved) {
      return sendHtml(res, 503, '<h1>Authorization storage failed.</h1>');
    }

    if (!this.ownerKeyHash || !/^[a-f0-9]{64}$/i.test(this.ownerKeyHash)) {
      return sendHtml(res, 503, '<h1>Owner verification is not configured.</h1>');
    }
    const clientName = escapeHtml(client.clientName || 'ChatGPT');
    sendHtml(
      res,
      200,
      '<!doctype html><html><head><meta charset="utf-8"><title>Connect KZ THRIVE Connect</title></head>' +
        '<body style="font-family:system-ui;max-width:560px;margin:60px auto;padding:20px">' +
        '<h1>Connect KZ THRIVE Connect</h1>' +
        '<p><strong>' +
        clientName +
        '</strong> is requesting read-only access to the Threads account already connected to this private service.</p>' +
        '<p>Scope: <code>' +
        escapeHtml(this.scope) +
        '</code></p>' +
        '<p>No publishing, reply, repost, delete or moderation permission is granted by this authorization.</p>' +
        '<form method="post" action="/oauth/approve">' +
        '<input type="hidden" name="txn" value="' +
        escapeHtml(txnId) +
        '">' +
        '<label>Owner key <input type="password" name="owner_key" autocomplete="off" required minlength="24"></label>' +
        '<button type="submit" style="padding:12px 18px;font-size:16px">Verify owner and authorize</button>' +
        '</form></body></html>'
    );
  }

  async approve(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const connectedUserId = this.getConnectedUserId();
    if (!connectedUserId) {
      return sendHtml(
        res,
        503,
        '<h1>Threads account is not connected.</h1>'
      );
    }

    const form = new URLSearchParams(await readBody(req));
    const ownerKey = form.get('owner_key') || '';
    if (!this.ownerKeyHash || ownerKey.length < 24 || !safeEqual(tokenHash(ownerKey), this.ownerKeyHash.toLowerCase())) {
      return sendHtml(res, 403, '<h1>Owner verification failed.</h1>');
    }
    const txnId = form.get('txn') || '';
    const key = TXN_PREFIX + txnId;
    const rawTxn = await this.store.get(key);
    const txn = rawTxn ? (JSON.parse(rawTxn) as OAuthTxn) : null;
    if (!txn) {
      return sendHtml(res, 400, '<h1>Authorization session expired.</h1>');
    }

    const code = randomToken();
    const codeRecord: OAuthCode = {
      ...txn,
      userId: connectedUserId,
    };

    const saved = await this.store.set(
      CODE_PREFIX + tokenHash(code),
      JSON.stringify(codeRecord),
      CODE_TTL_SECONDS
    );
    if (!saved) {
      return sendHtml(res, 503, '<h1>Authorization failed.</h1>');
    }

    await this.store.del(key);

    const redirect = new URL(txn.redirectUri);
    redirect.searchParams.set('code', code);
    if (txn.state) redirect.searchParams.set('state', txn.state);

    res.writeHead(302, {
      Location: redirect.toString(),
      'Cache-Control': 'no-store',
    });
    res.end();
  }

  async token(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    const grantType = form.get('grant_type') || '';
    const clientId = form.get('client_id') || '';
    const resource = form.get('resource') || this.resourceUrl;

    if (resource !== this.resourceUrl) {
      return sendJson(res, 400, { error: 'invalid_target' });
    }

    if (grantType === 'authorization_code') {
      const code = form.get('code') || '';
      const redirectUri = form.get('redirect_uri') || '';
      const verifier = form.get('code_verifier') || '';
      const key = CODE_PREFIX + tokenHash(code);
      const rawCode = await this.store.get(key);
      const stored = rawCode ? (JSON.parse(rawCode) as OAuthCode) : null;

      if (
        !stored ||
        stored.clientId !== clientId ||
        stored.redirectUri !== redirectUri ||
        !verifier ||
        !safeEqual(pkceS256(verifier), stored.codeChallenge)
      ) {
        return sendJson(res, 400, { error: 'invalid_grant' });
      }

      await this.store.del(key);
      return this.issueTokens(res, stored.clientId, stored.userId, stored.scope);
    }

    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token') || '';
      const key = REFRESH_PREFIX + tokenHash(refreshToken);
      const rawRecord = await this.store.get(key);
      const stored = rawRecord
        ? (JSON.parse(rawRecord) as OAuthTokenRecord)
        : null;

      if (
        !stored ||
        stored.clientId !== clientId ||
        stored.resource !== this.resourceUrl ||
        stored.expiresAt <= Date.now()
      ) {
        return sendJson(res, 400, { error: 'invalid_grant' });
      }

      await this.store.del(key);
      return this.issueTokens(res, stored.clientId, stored.userId, stored.scope);
    }

    return sendJson(res, 400, { error: 'unsupported_grant_type' });
  }

  async verifyAccessToken(token: string): Promise<OAuthTokenRecord | null> {
    const raw = await this.store.get(ACCESS_PREFIX + tokenHash(token));
    const record = raw ? (JSON.parse(raw) as OAuthTokenRecord) : null;
    if (
      !record ||
      record.expiresAt <= Date.now() ||
      record.resource !== this.resourceUrl ||
      !record.scope.split(/\s+/).includes(this.scope)
    ) {
      return null;
    }
    return record;
  }

  private async issueTokens(
    res: http.ServerResponse,
    clientId: string,
    userId: string,
    scope: string
  ): Promise<void> {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const access: OAuthTokenRecord = {
      clientId,
      userId,
      scope,
      resource: this.resourceUrl,
      expiresAt: Date.now() + ACCESS_TTL_SECONDS * 1000,
    };
    const refresh: OAuthTokenRecord = {
      ...access,
      expiresAt: Date.now() + REFRESH_TTL_SECONDS * 1000,
    };

    const accessSaved = await this.store.set(
      ACCESS_PREFIX + tokenHash(accessToken),
      JSON.stringify(access),
      ACCESS_TTL_SECONDS
    );
    const refreshSaved = await this.store.set(
      REFRESH_PREFIX + tokenHash(refreshToken),
      JSON.stringify(refresh),
      REFRESH_TTL_SECONDS
    );

    if (!accessSaved || !refreshSaved) {
      return sendJson(res, 503, { error: 'temporarily_unavailable' });
    }

    return sendJson(res, 200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refreshToken,
      scope,
    });
  }
}
