/**
 * Staging-only Supabase persistence adapter.
 * Import explicitly from a trusted server process. No route / timer is registered.
 * SERVICE ROLE credentials must never reach the browser or ChatGPT.
 */
import type { ScheduledPost, ScheduledPostStore } from './scheduled-publishing.js';

type Row = {
  id: string; account_id: string; text_content: string; content_hash: string;
  revision: number; status: ScheduledPost['status'];
  approved_by: string | null; approved_at: string | null;
  approved_revision: number | null; scheduled_at: string | null;
  published_id: string | null; last_error: string | null;
};

function fromRow(row: Row): ScheduledPost {
  return {
    id: row.id, accountId: row.account_id, text: row.text_content,
    contentHash: row.content_hash, revision: row.revision, status: row.status,
    approvedBy: row.approved_by ?? undefined, approvedAt: row.approved_at ?? undefined,
    approvedRevision: row.approved_revision ?? undefined,
    scheduledAt: row.scheduled_at ?? undefined,
    publishedId: row.published_id ?? undefined, lastError: row.last_error ?? undefined,
  };
}
function toRow(post: ScheduledPost): Row {
  return {
    id: post.id, account_id: post.accountId, text_content: post.text,
    content_hash: post.contentHash, revision: post.revision, status: post.status,
    approved_by: post.approvedBy ?? null, approved_at: post.approvedAt ?? null,
    approved_revision: post.approvedRevision ?? null,
    scheduled_at: post.scheduledAt ?? null, published_id: post.publishedId ?? null,
    last_error: post.lastError ?? null,
  };
}

export class SupabaseScheduleStore implements ScheduledPostStore {
  private readonly endpoint: string;
  constructor(projectUrl: string, private readonly serviceRoleKey: string) {
    const parsed = new URL(projectUrl);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co'))
      throw new Error('INVALID_SUPABASE_URL');
    if (!serviceRoleKey) throw new Error('SERVICE_ROLE_KEY_REQUIRED');
    this.endpoint = parsed.origin + '/rest/v1/kz_threads_scheduled_posts';
  }

  private headers(prefer?: string): Record<string,string> {
    return {
      apikey: this.serviceRoleKey,
      Authorization: 'Bearer ' + this.serviceRoleKey,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    };
  }

  async get(id: string): Promise<ScheduledPost | null> {
    const response = await fetch(this.endpoint + '?id=eq.' + encodeURIComponent(id) + '&select=*', {
      headers: this.headers(),
    });
    if (!response.ok) throw new Error('STORE_READ_FAILED:' + response.status);
    const rows = await response.json() as Row[];
    return rows.length ? fromRow(rows[0]) : null;
  }

  async insert(post: ScheduledPost): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST', headers: this.headers('return=minimal'),
      body: JSON.stringify(toRow(post)),
    });
    if (!response.ok) throw new Error('STORE_INSERT_FAILED:' + response.status);
  }

  async compareAndSwap(id: string, expectedRevision: number, post: ScheduledPost): Promise<boolean> {
    // PostgreSQL UPDATE is atomic; filters ensure only one competing revision wins.
    if (post.id !== id || post.revision !== expectedRevision + 1)
      throw new Error('INVALID_CAS_REVISION');
    const filters = '?id=eq.' + encodeURIComponent(id) +
      '&revision=eq.' + encodeURIComponent(String(expectedRevision)) + '&select=id';
    const response = await fetch(this.endpoint + filters, {
      method: 'PATCH', headers: this.headers('return=representation'),
      body: JSON.stringify(toRow(post)),
    });
    if (!response.ok) throw new Error('STORE_CAS_FAILED:' + response.status);
    const updated = await response.json() as Array<{ id:string }>;
    return updated.length === 1;
  }
}
