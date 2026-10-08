/** Staging scheduler: explicitly dry-run only; no Threads write API calls. */
import type { ScheduledPost } from './scheduled-publishing.js';
export type DuePreview = { id: string; revision: number; accountId: string; dueAt: string; decision: 'ELIGIBLE_FOR_REVIEW' | 'SKIP'; reason: string };
export function previewDue(posts: ScheduledPost[], now: Date): DuePreview[] {
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_CLOCK');
  return posts.map(post => {
    const valid = post.status === 'SCHEDULED' &&
      post.approvedBy === 'KZ' &&
      post.approvedRevision === post.revision &&
      Boolean(post.scheduledAt) &&
      Number.isFinite(Date.parse(post.scheduledAt!)) &&
      Date.parse(post.scheduledAt!) <= now.getTime();
    return {
      id: post.id, revision: post.revision, accountId: post.accountId,
      dueAt: post.scheduledAt || '',
      decision: valid ? 'ELIGIBLE_FOR_REVIEW' : 'SKIP',
      reason: valid ? 'AWAITING_WRITE_GATE_AND_DISPATCH' : 'NOT_DUE_OR_NOT_APPROVED',
    };
  });
}
