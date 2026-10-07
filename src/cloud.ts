import * as http from 'http';
import { URL } from 'url';

const port = Number(process.env.PORT || 10000);
const publicBaseUrl = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const redirectUri = process.env.THREADS_REDIRECT_URI || (publicBaseUrl ? publicBaseUrl + '/oauth/callback' : '');

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

const server = http.createServer((req, res) => {
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
      redirectUri: redirectUri || null,
      oauthConfigured: Boolean(process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET),
    });
  }

  if (req.method === 'GET' && url.pathname === '/oauth/callback') {
    return sendHtml(
      res,
      200,
      '<h1>KZ Threads MCP OAuth callback is online.</h1><p>OAuth exchange will be enabled after Meta credentials are configured privately in Render.</p>'
    );
  }

  if (req.method === 'GET' && url.pathname === '/oauth/start') {
    return sendJson(res, 503, {
      error: 'OAUTH_NOT_CONFIGURED',
      message: 'OAuth start will be enabled after Meta credentials are configured in Render.',
      redirectUri: redirectUri || null,
    });
  }

  return sendJson(res, 404, { error: 'NOT_FOUND' });
});

server.listen(port, '0.0.0.0', () => {
  console.error('KZ Threads MCP cloud service listening on port ' + port);
});
