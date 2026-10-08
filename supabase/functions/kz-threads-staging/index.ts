// KZ THREADS STAGING — isolated, server-only, read-only preflight.
// No publishing, write endpoints, timers or autonomous scheduler are enabled.
const reply = (status: number, obj: Record<string, unknown>): Response =>
  new Response(JSON.stringify(obj), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  } });

Deno.serve(async (req) => {
  // Supabase Edge Function also has verify_jwt=true. Require the server-side
  // service role bearer explicitly: ordinary anon/authenticated JWTs fail closed.
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const projectUrl = Deno.env.get('SUPABASE_URL') || '';
  const bearer = req.headers.get('authorization') || '';
  if (!secret || !projectUrl || bearer !== 'Bearer ' + secret)
    return reply(403, { error: 'STAGING_SERVICE_ONLY' });
  if (req.method !== 'GET')
    return reply(405, { error: 'READ_ONLY', productionWriteEnabled: false });
  const pathname = new URL(req.url).pathname;
  const action = pathname.endsWith('/due-preview') ? 'due-preview' : 'preflight';
  try {
    const url = new URL('/rest/v1/kz_threads_scheduled_posts', projectUrl);
    if (action === 'due-preview') {
      url.searchParams.set('select', 'id,revision,approved_revision,approved_by,status,scheduled_at');
      url.searchParams.set('status', 'eq.SCHEDULED');
      url.searchParams.set('scheduled_at', 'lte.' + new Date().toISOString());
      url.searchParams.set('limit', '100');
    } else {
      url.searchParams.set('select', 'id');
      url.searchParams.set('limit', '1');
    }
    const db = await fetch(url.toString(), { headers: {
      apikey: secret, Authorization: 'Bearer ' + secret,
      Accept: 'application/json',
    } });
    if (!db.ok) return reply(503, { error: 'DATABASE_PREFLIGHT_FAILED', databaseStatus: db.status });
    const rows = await db.json();
    if (!Array.isArray(rows)) return reply(503, { error: 'DATABASE_UNEXPECTED_RESULT' });
    if (action === 'due-preview') {
      const eligible = rows.filter((r: Record<string, unknown>) =>
        r.status === 'SCHEDULED' && r.approved_by === 'KZ' &&
        r.revision === r.approved_revision && typeof r.scheduled_at === 'string' &&
        Date.parse(r.scheduled_at) <= Date.now());
      return reply(200, {
        staging: true, readOnly: true, action, eligibleCount: eligible.length,
        truncated: rows.length === 100, publishingEnabled: false,
      });
    }
    return reply(200, {
      staging: true, readOnly: true, databaseConnected: true,
      publishingEnabled: false, schedulerEnabled: false,
    });
  } catch {
    return reply(503, { error: 'DATABASE_PREFLIGHT_UNAVAILABLE' });
  }
});
