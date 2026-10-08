import * as http from 'http';
import { URL } from 'url';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { ThreadsOAuth } from './auth/oauth.js';
import { McpOAuthServer } from './mcp-oauth.js';
import { ThreadsClient } from './client/threads-client.js';
import * as net from 'net';
import * as tls from 'tls';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ThreadsMCPServer } from './server.js';

const port = Number(process.env.PORT || 10000);
const appId = process.env.THREADS_APP_ID;
const appSecret = process.env.THREADS_APP_SECRET;
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const redirectUri =
  process.env.THREADS_REDIRECT_URI ||
  (publicBaseUrl ? publicBaseUrl + '/oauth/callback' : '');
const redisUrl = process.env.REDIS_URL;
const mcpBearerToken = process.env.MCP_REMOTE_BEARER_TOKEN;
const TOKEN_KEY = 'kz:threads:oauth-token';

const scopes = [
  'threads_basic',
  'threads_content_publish',
  'threads_manage_insights',
  'threads_manage_replies',
  'threads_read_replies',
  'threads_keyword_search',
  'threads_manage_mentions',
  'threads_delete',
  'threads_location_tagging',
  'threads_profile_discovery',
];

type SmokeCheck = {
  ok: boolean;
  detail?: string;
};

type SmokeResult = {
  profile?: SmokeCheck;
  threads?: SmokeCheck;
  thread?: SmokeCheck;
  replies?: SmokeCheck;
  search?: SmokeCheck;
  insights?: SmokeCheck;
};

type AuthState = {
  authenticated: boolean;
  userId?: string;
  expiresAt?: number;
  persistent?: boolean;
  smoke?: SmokeResult;
};

const authState: AuthState = { authenticated: false };
let activeAccessToken: string | null = null;
const completedStates = new Set<string>();
const inFlightStates = new Map<
  string,
  Promise<{ accessToken: string; userId: string; expiresIn: number }>
>();
const STATE_TTL_MS = 10 * 60 * 1000;

type McpSession = {
  transport: StreamableHTTPServerTransport;
  server: ThreadsMCPServer;
};

const mcpSessions = new Map<string, McpSession>();
const oauthServer = publicBaseUrl ? new McpOAuthServer({
  baseUrl: publicBaseUrl,
  resourceUrl: publicBaseUrl + '/mcp',
  scope: 'threads.read',
  ownerKeyHash: process.env.KZ_MCP_OWNER_KEY_SHA256 || '',
  getConnectedUserId: () => authState.userId || null,
  store: {
    get: async (key) => redisCommand(['GET', key]),
    set: async (key, value, ttl) =>
      (await redisCommand(['SET', key, value, 'EX', String(ttl)])) === 'OK',
    del: async (key) => { await redisCommand(['DEL', key]); },
  },
}) : null;


async function mcpRequestAuthorized(req: http.IncomingMessage): Promise<boolean> {
  const header = req.headers.authorization;
  if (!header || Array.isArray(header) || !header.startsWith('Bearer ')) {
    return false;
  }

  const token = header.slice('Bearer '.length);
  if (oauthServer && await oauthServer.verifyAccessToken(token)) return true;
  if (!mcpBearerToken) return false;
  const supplied = Buffer.from(token);
  const expected = Buffer.from(mcpBearerToken);

  return (
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
  );
}

async function handleMcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!await mcpRequestAuthorized(req)) {
    res.setHeader('WWW-Authenticate',
      'Bearer resource_metadata="' + publicBaseUrl + '/.well-known/oauth-protected-resource", scope="threads.read"');
    return sendJson(res, 401, {
      error: 'UNAUTHORIZED',
    });
  }

  if (!activeAccessToken || !authState.userId) {
    return sendJson(res, 503, {
      error: 'THREADS_NOT_AUTHENTICATED',
    });
  }

  const rawSessionId = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(rawSessionId)
    ? rawSessionId[0]
    : rawSessionId;

  if (sessionId) {
    const existing = mcpSessions.get(sessionId);
    if (!existing) {
      return sendJson(res, 404, {
        error: 'MCP_SESSION_NOT_FOUND',
      });
    }

    await existing.transport.handleRequest(req, res);
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, 400, {
      error: 'MCP_SESSION_REQUIRED',
    });
  }

  const mcpServer = new ThreadsMCPServer();
  mcpServer.setClient(
    new ThreadsClient({
      accessToken: activeAccessToken,
      userId: authState.userId,
    })
  );

  let transport: StreamableHTTPServerTransport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id) => {
      mcpSessions.set(id, {
        transport,
        server: mcpServer,
      });
      console.error('Remote MCP session initialized.');
    },
    onsessionclosed: (id) => {
      mcpSessions.delete(id);
      console.error('Remote MCP session closed.');
    },
  });

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res);
}

function encodeRedisCommand(parts: string[]): string {
  let out = '*' + parts.length + '\r\n';
  for (const part of parts) {
    out += '$' + Buffer.byteLength(part) + '\r\n' + part + '\r\n';
  }
  return out;
}

function parseRedisReply(raw: string): string | null {
  const lines = raw.split('\r\n');
  let index = 0;
  let last: string | null = null;

  while (index < lines.length) {
    const line = lines[index++];
    if (!line) continue;

    if (line.startsWith('+')) {
      last = line.slice(1);
      continue;
    }

    if (line.startsWith('-')) {
      throw new Error('Redis error: ' + line.slice(1));
    }

    if (line.startsWith('$')) {
      const length = Number(line.slice(1));
      if (length === -1) {
        last = null;
        continue;
      }
      const value = lines[index++] ?? '';
      last = value;
      continue;
    }

    if (line.startsWith(':')) {
      last = line.slice(1);
    }
  }

  return last;
}

async function redisCommand(command: string[]): Promise<string | null> {
  if (!redisUrl) return null;

  const target = new URL(redisUrl);
  const host = target.hostname;
  const port = Number(target.port || (target.protocol === 'rediss:' ? 6380 : 6379));
  const password = target.password ? decodeURIComponent(target.password) : '';
  const username = target.username ? decodeURIComponent(target.username) : '';

  const commands: string[][] = [];
  if (password) {
    commands.push(username ? ['AUTH', username, password] : ['AUTH', password]);
  }
  commands.push(command);

  const payload = commands.map(encodeRedisCommand).join('');

  return await new Promise<string | null>((resolve, reject) => {
    let data = '';
    let settled = false;

    const onConnect = () => {
      socket.write(payload);
    };

    const socket =
      target.protocol === 'rediss:'
        ? tls.connect({ host, port, servername: host }, onConnect)
        : net.createConnection({ host, port }, onConnect);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error('Redis command timed out'));
      }
    }, 5000);

    socket.setEncoding('utf8');

    socket.on('data', (chunk) => {
      data += chunk;

      try {
        const result = parseRedisReply(data);
        const expectedReplies = commands.length;
        const replyCount = (data.match(/(?:^|\r\n)[+\-$:]/g) || []).length;

        if (!settled && replyCount >= expectedReplies) {
          settled = true;
          clearTimeout(timer);
          socket.end();
          resolve(result);
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          reject(error);
        }
      }
    });

    socket.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });

    socket.on('end', () => {
      if (!settled) {
        try {
          settled = true;
          clearTimeout(timer);
          resolve(parseRedisReply(data));
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}

async function saveToken(token: {
  accessToken: string;
  userId: string;
  expiresAt: number;
}): Promise<boolean> {
  if (!redisUrl) return false;

  const payload = JSON.stringify(token);
  const result = await redisCommand(['SET', TOKEN_KEY, payload]);
  return result === 'OK';
}

async function loadToken(): Promise<{
  accessToken: string;
  userId: string;
  expiresAt: number;
} | null> {
  if (!redisUrl) return null;

  const value = await redisCommand(['GET', TOKEN_KEY]);
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as {
      accessToken?: string;
      userId?: string;
      expiresAt?: number;
    };

    if (
      !parsed.accessToken ||
      !parsed.userId ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }

    return {
      accessToken: parsed.accessToken,
      userId: parsed.userId,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function checkDetail(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : 'Unknown error';
}

async function runReadSmoke(
  accessToken: string,
  userId: string
): Promise<SmokeResult> {
  const smoke: SmokeResult = {};
  const client = new ThreadsClient({
    accessToken,
    userId,
  });

  let latestThreadId: string | undefined;

  try {
    const profile = await client.getProfile(['id', 'username', 'name']);
    smoke.profile = {
      ok: true,
      detail: profile.username ? 'profile:' + profile.username : 'profile-read-pass',
    };
  } catch (error) {
    smoke.profile = { ok: false, detail: checkDetail(error) };
  }

  try {
    const threads = await client.getThreads({
      limit: 5,
      fields: [
        'id',
        'media_product_type',
        'media_type',
        'permalink',
        'username',
        'text',
        'timestamp',
      ],
    });
    latestThreadId = threads[0]?.id;
    smoke.threads = {
      ok: true,
      detail: 'posts:' + threads.length,
    };
  } catch (error) {
    smoke.threads = { ok: false, detail: checkDetail(error) };
  }

  if (latestThreadId) {
    try {
      await client.getThread(latestThreadId, [
        'id',
        'media_product_type',
        'media_type',
        'permalink',
        'username',
        'text',
        'timestamp',
      ]);
      smoke.thread = { ok: true, detail: 'latest-post-read-pass' };
    } catch (error) {
      smoke.thread = { ok: false, detail: checkDetail(error) };
    }

    try {
      const replies = await client.getReplies(latestThreadId, {
        fields: ['id', 'text', 'username', 'timestamp'],
        reverse: false,
      });
      smoke.replies = {
        ok: true,
        detail: 'replies:' + (replies.data?.length ?? 0),
      };
    } catch (error) {
      smoke.replies = { ok: false, detail: checkDetail(error) };
    }

    try {
      const insights = await client.getThreadInsights(latestThreadId, {
        metric: ['views', 'likes', 'replies', 'reposts', 'quotes'],
      });
      smoke.insights = {
        ok: true,
        detail: 'metrics:' + insights.length,
      };
    } catch (error) {
      smoke.insights = { ok: false, detail: checkDetail(error) };
    }
  }

  try {
    await client.searchThreads('marketing', {
      searchType: 'TOP',
      limit: 3,
      fields: ['id', 'username', 'text', 'timestamp', 'permalink'],
    });
    smoke.search = { ok: true, detail: 'keyword-search-pass' };
  } catch (error) {
    smoke.search = { ok: false, detail: checkDetail(error) };
  }

  return smoke;
}


async function runRemoteMcpSelfTest(): Promise<void> {
  if (!mcpBearerToken || !activeAccessToken || !authState.userId) {
    console.error('Remote MCP self-test: SKIPPED_NOT_READY');
    return;
  }

  const endpoint = 'http://127.0.0.1:' + port + '/mcp';
  const initializeBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'kz-remote-mcp-selftest',
        version: '1.0.0',
      },
    },
  };

  const baseHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  const unauth = await fetch(endpoint, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify(initializeBody),
  });

  if (unauth.status !== 401) {
    throw new Error('Expected unauthenticated MCP request to return 401');
  }

  const init = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      Authorization: 'Bearer ' + mcpBearerToken,
    },
    body: JSON.stringify(initializeBody),
  });

  if (!init.ok) {
    throw new Error('Authenticated MCP initialize failed with status ' + init.status);
  }

  const sessionId = init.headers.get('mcp-session-id');
  if (!sessionId) {
    throw new Error('Authenticated MCP initialize did not return a session ID');
  }

  const protocolHeaders = {
    ...baseHeaders,
    Authorization: 'Bearer ' + mcpBearerToken,
    'mcp-session-id': sessionId,
    'mcp-protocol-version': '2025-03-26',
  };

  const initialized = await fetch(endpoint, {
    method: 'POST',
    headers: protocolHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }),
  });

  if (initialized.status !== 202) {
    throw new Error('MCP initialized notification failed with status ' + initialized.status);
  }

  const listTools = await fetch(endpoint, {
    method: 'POST',
    headers: protocolHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });

  if (!listTools.ok) {
    throw new Error('MCP tools/list failed with status ' + listTools.status);
  }

  const toolsPayload = (await listTools.json()) as {
    result?: { tools?: Array<{ name?: string }> };
  };
  const toolNames = toolsPayload.result?.tools?.map((tool) => tool.name) ?? [];

  if (toolNames.length !== 17) {
    throw new Error('Expected 17 MCP tools, received ' + toolNames.length);
  }

  const profileCall = await fetch(endpoint, {
    method: 'POST',
    headers: protocolHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'threads_get_profile',
        arguments: {
          fields: ['id', 'username', 'name'],
        },
      },
    }),
  });

  if (!profileCall.ok) {
    throw new Error('MCP read tool call failed with status ' + profileCall.status);
  }

  const profilePayload = (await profileCall.json()) as {
    result?: { content?: Array<{ type?: string; text?: string }> };
  };

  const profileText = profilePayload.result?.content?.find(
    (item) => item.type === 'text'
  )?.text;

  if (!profileText || !profileText.includes('kzbinzainal')) {
    throw new Error('MCP read tool did not return expected profile');
  }

  await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      Authorization: 'Bearer ' + mcpBearerToken,
      'mcp-session-id': sessionId,
      'mcp-protocol-version': '2025-03-26',
      Accept: 'application/json, text/event-stream',
    },
  });

  console.error(
    'Remote MCP self-test: PASS (401 guard, initialize, 17 tools, profile read)'
  );
}

function createSignedState(): string {
  if (!appSecret) throw new Error('OAuth app secret is not configured');

  const payload = Buffer.from(
    JSON.stringify({
      ts: Date.now(),
      nonce: randomUUID(),
    })
  ).toString('base64url');

  const signature = createHmac('sha256', appSecret)
    .update(payload)
    .digest('base64url');

  return payload + '.' + signature;
}

function verifySignedState(state: string): boolean {
  if (!appSecret) return false;

  const parts = state.split('.');
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  const expected = createHmac('sha256', appSecret)
    .update(payload)
    .digest('base64url');

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return false;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as { ts?: number };

    return (
      typeof parsed.ts === 'number' &&
      Date.now() - parsed.ts >= 0 &&
      Date.now() - parsed.ts <= STATE_TTL_MS
    );
  } catch {
    return false;
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function oauthConfigured(): boolean {
  return Boolean(appId && appSecret && redirectUri);
}

function getOAuth(): ThreadsOAuth {
  if (!appId || !appSecret || !redirectUri) {
    throw new Error('OAuth is not configured');
  }

  return new ThreadsOAuth({
    appId,
    appSecret,
    redirectUri,
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));

  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, {
      service: 'kz-threads-mcp',
      mode: 'human-controlled-v2',
      status: 'online',
      primaryRoute: 'ChatGPT -> THRIVE OS -> KZ Threads MCP -> Official Meta Threads API',
      tia: 'optional',
      remoteMcp: {
        path: '/mcp',
        transport: 'streamable-http',
        authentication: 'oauth2-or-internal-bearer',
        configured: Boolean(oauthServer && redisUrl),
      },
    });
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      oauthConfigured: oauthConfigured(),
      redirectUri: redirectUri || null,
      authenticated: authState.authenticated,
      remoteMcpConfigured: Boolean(oauthServer && redisUrl),
      remoteMcpSessions: mcpSessions.size,
    });
  }

  if (oauthServer && req.method === 'GET' &&
    (url.pathname === '/.well-known/oauth-protected-resource' ||
     url.pathname === '/.well-known/oauth-protected-resource/mcp')) {
    return sendJson(res, 200, oauthServer.protectedResourceMetadata());
  }
  if (oauthServer && req.method === 'GET' &&
      url.pathname === '/.well-known/oauth-authorization-server') {
    return sendJson(res, 200, oauthServer.authorizationServerMetadata());
  }
  if (oauthServer && req.method === 'POST' && url.pathname === '/oauth/register') {
    try { await oauthServer.register(req, res); }
    catch (error) { console.error('OAuth registration failed:', checkDetail(error));
      if (!res.headersSent) sendJson(res, 400, { error: 'invalid_client_metadata' }); }
    return;
  }
  if (oauthServer && req.method === 'GET' && url.pathname === '/oauth/authorize') {
    try { await oauthServer.authorize(url, res); }
    catch (error) { console.error('OAuth authorize failed:', checkDetail(error));
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' }); }
    return;
  }
  if (oauthServer && req.method === 'POST' && url.pathname === '/oauth/approve') {
    try { await oauthServer.approve(req, res); }
    catch (error) { console.error('OAuth approve failed:', checkDetail(error));
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' }); }
    return;
  }
  if (oauthServer && req.method === 'POST' && url.pathname === '/oauth/token') {
    try { await oauthServer.token(req, res); }
    catch (error) { console.error('OAuth token failed:', checkDetail(error));
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' }); }
    return;
  }

  if (url.pathname === '/mcp') {
    try {
      await handleMcpRequest(req, res);
    } catch (error) {
      console.error('Remote MCP request failed:', checkDetail(error));
      if (!res.headersSent) {
        return sendJson(res, 500, {
          error: 'MCP_REQUEST_FAILED',
        });
      }
      res.end();
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/oauth/status') {
    return sendJson(res, 200, {
      configured: oauthConfigured(),
      authenticated: authState.authenticated,
      userId: authState.userId || null,
      expiresAt: authState.expiresAt || null,
      persistent: Boolean(authState.persistent),
      smoke: authState.smoke || null,
      redirectUri: redirectUri || null,
    });
  }

  if (req.method === 'GET' && url.pathname === '/oauth/start') {
    if (!oauthConfigured()) {
      return sendJson(res, 503, {
        error: 'OAUTH_NOT_CONFIGURED',
        message: 'Set THREADS_APP_ID and THREADS_APP_SECRET in Render environment variables.',
        redirectUri: redirectUri || null,
      });
    }

    const state = createSignedState();
    const authUrl = getOAuth().getAuthorizationUrl(scopes, state);
    res.writeHead(302, {
      Location: authUrl,
      'Cache-Control': 'no-store',
    });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/oauth/callback') {
    if (!oauthConfigured()) {
      return sendHtml(res, 503, '<h1>OAuth is not configured yet.</h1>');
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return sendHtml(
        res,
        400,
        '<h1>Threads authorization was not completed.</h1>'
      );
    }

    if (!state || !verifySignedState(state)) {
      return sendHtml(res, 400, '<h1>Invalid or expired OAuth state.</h1>');
    }

    if (!code) {
      return sendHtml(res, 400, '<h1>No authorization code received.</h1>');
    }

    if (completedStates.has(state) && authState.authenticated) {
      return sendHtml(
        res,
        200,
        '<h1>KZ Threads MCP already connected successfully.</h1><p>You can close this window and return to ChatGPT.</p>'
      );
    }

    try {
      let exchange = inFlightStates.get(state);
      if (!exchange) {
        exchange = getOAuth().completeOAuthFlow(code);
        inFlightStates.set(state, exchange);
      }

      const result = await exchange;

      activeAccessToken = result.accessToken;
      authState.authenticated = true;
      authState.userId = result.userId;
      authState.expiresAt = Date.now() + result.expiresIn * 1000;

      try {
        authState.persistent = await saveToken({
          accessToken: result.accessToken,
          userId: result.userId,
          expiresAt: authState.expiresAt,
        });
      } catch (error) {
        authState.persistent = false;
        console.error('Persistent token save failed:', checkDetail(error));
      }

      authState.smoke = await runReadSmoke(result.accessToken, result.userId);
      completedStates.add(state);
      inFlightStates.delete(state);

      console.error('Threads OAuth completed for user ID:', result.userId);
      console.error('Access token is not logged.');
      console.error('Persistent token store:', authState.persistent ? 'PASS' : 'NOT_CONFIGURED');
      console.error('Read smoke summary:', JSON.stringify(authState.smoke));

      return sendHtml(
        res,
        200,
        '<h1>KZ Threads MCP connected successfully.</h1><p>You can close this window and return to ChatGPT.</p>'
      );
    } catch (error) {
      inFlightStates.delete(state);

      if (authState.authenticated && activeAccessToken) {
        console.error('Duplicate OAuth callback ignored after successful authentication.');
        return sendHtml(
          res,
          200,
          '<h1>KZ Threads MCP already connected successfully.</h1><p>You can close this window and return to ChatGPT.</p>'
        );
      }

      console.error(
        'Threads OAuth exchange failed:',
        error instanceof Error ? error.message : 'Unknown error'
      );

      return sendHtml(
        res,
        500,
        '<h1>Threads OAuth failed.</h1><p>Return to ChatGPT for the next check.</p>'
      );
    }
  }

  return sendJson(res, 404, { error: 'NOT_FOUND' });
});

server.listen(port, '0.0.0.0', async () => {
  console.error('KZ Threads MCP cloud service listening on port ' + port);
  console.error('OAuth callback:', redirectUri || 'PENDING');
  console.error(
    'Remote MCP transport:',
    mcpBearerToken ? 'READY_BEARER_PROTECTED' : 'AUTH_NOT_CONFIGURED'
  );

  try {
    const stored = await loadToken();
    if (stored) {
      activeAccessToken = stored.accessToken;
      authState.authenticated = true;
      authState.userId = stored.userId;
      authState.expiresAt = stored.expiresAt;
      authState.persistent = true;
      authState.smoke = await runReadSmoke(stored.accessToken, stored.userId);
      console.error('Persistent Threads token restored successfully.');
      console.error('Read smoke summary:', JSON.stringify(authState.smoke));

      try {
        await runRemoteMcpSelfTest();
      } catch (error) {
        console.error('Remote MCP self-test: FAIL -', checkDetail(error));
      }
    } else {
      authState.persistent = false;
    }
  } catch (error) {
    authState.persistent = false;
    console.error('Persistent token restore failed:', checkDetail(error));
  }
});
