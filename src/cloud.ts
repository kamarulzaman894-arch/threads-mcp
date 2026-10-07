import * as http from 'http';
import { URL } from 'url';
import { randomUUID } from 'crypto';
import { ThreadsOAuth } from './auth/oauth.js';

const port = Number(process.env.PORT || 10000);
const appId = process.env.THREADS_APP_ID;
const appSecret = process.env.THREADS_APP_SECRET;
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const redirectUri =
  process.env.THREADS_REDIRECT_URI ||
  (publicBaseUrl ? publicBaseUrl + '/oauth/callback' : '');

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

type AuthState = {
  authenticated: boolean;
  userId?: string;
  expiresAt?: number;
};

const authState: AuthState = { authenticated: false };
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

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

function cleanupStates(): void {
  const now = Date.now();
  for (const [state, createdAt] of pendingStates.entries()) {
    if (now - createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
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
    });
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      oauthConfigured: oauthConfigured(),
      redirectUri: redirectUri || null,
      authenticated: authState.authenticated,
    });
  }

  if (req.method === 'GET' && url.pathname === '/oauth/status') {
    return sendJson(res, 200, {
      configured: oauthConfigured(),
      authenticated: authState.authenticated,
      userId: authState.userId || null,
      expiresAt: authState.expiresAt || null,
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

    cleanupStates();
    const state = randomUUID();
    pendingStates.set(state, Date.now());

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

    cleanupStates();
    if (!state || !pendingStates.has(state)) {
      return sendHtml(res, 400, '<h1>Invalid or expired OAuth state.</h1>');
    }
    pendingStates.delete(state);

    if (!code) {
      return sendHtml(res, 400, '<h1>No authorization code received.</h1>');
    }

    try {
      const result = await getOAuth().completeOAuthFlow(code);

      authState.authenticated = true;
      authState.userId = result.userId;
      authState.expiresAt = Date.now() + result.expiresIn * 1000;

      console.error('Threads OAuth completed for user ID:', result.userId);
      console.error('Token expiry stored in memory; access token is not logged.');

      return sendHtml(
        res,
        200,
        '<h1>KZ Threads MCP connected successfully.</h1><p>You can close this window and return to ChatGPT.</p>'
      );
    } catch (error) {
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

server.listen(port, '0.0.0.0', () => {
  console.error('KZ Threads MCP cloud service listening on port ' + port);
  console.error('OAuth callback:', redirectUri || 'PENDING');
});
