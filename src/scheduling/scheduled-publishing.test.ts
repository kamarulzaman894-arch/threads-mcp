import { describe, it, expect } from 'vitest';
import { ScheduledPublishingService, type ScheduledPost, type ScheduledPostStore } from './scheduled-publishing.js';

function setup() {
  const map = new Map<string, ScheduledPost>();
  const store: ScheduledPostStore = {
    async get(id) { return map.get(id) ?? null; },
    async insert(post) { map.set(post.id, post); },
    async compareAndSwap(id, rev, next) {
      if (map.get(id)?.revision !== rev) return false;
      map.set(id, next);
      return true;
    },
  };
  return new ScheduledPublishingService(store);
}
const tomorrow = () => new Date(Date.now() + 86400000).toISOString();
const enabled = { productionReadOnly: false, writeTestsPassed: true, humanWriteEnablement: true };
describe('approval-first scheduling guardrails', () => {
  it('requires KZ approval before scheduling', async () => {
    const svc = setup();
    const d = await svc.draft('test-account', 'Test post');
    await expect(svc.schedule(d.id, d.revision, tomorrow())).rejects.toThrow('APPROVAL_REQUIRED');
    await expect(svc.approve(d.id, d.revision, 'other')).rejects.toThrow('KZ_APPROVAL_REQUIRED');
  });
  it('prevents write while production is read-only', async () => {
    const svc = setup();
    const d = await svc.draft('test-account', 'Test post');
    const a = await svc.approve(d.id, d.revision, 'KZ');
    const s = await svc.schedule(d.id, a.revision, tomorrow());
    await expect(svc.claimDue(s.id, s.revision, new Date(Date.now()+2*86400000),
      { ...enabled, productionReadOnly: true })).rejects.toThrow('PRODUCTION_WRITE_DISABLED');
  });
  it('requires renewed approval after editing', async () => {
    const svc = setup();
    const d = await svc.draft('test-account', 'Original');
    const a = await svc.approve(d.id, d.revision, 'KZ');
    const changed = await svc.revise(d.id, a.revision, 'Revised');
    expect(changed.approvedBy).toBeUndefined();
    await expect(svc.schedule(d.id, changed.revision, tomorrow())).rejects.toThrow('APPROVAL_REQUIRED');
  });
  it('rejects stale revisions and prevents duplicate claims', async () => {
    const svc = setup();
    const d = await svc.draft('test-account', 'Original');
    const a = await svc.approve(d.id, d.revision, 'KZ');
    const s = await svc.schedule(d.id, a.revision, tomorrow());
    const claim = await svc.claimDue(s.id, s.revision, new Date(Date.now()+2*86400000), enabled);
    expect(claim.status).toBe('PUBLISHING');
    await expect(svc.claimDue(s.id, s.revision, new Date(Date.now()+2*86400000), enabled))
      .rejects.toThrow('STALE_REVISION');
  });
  it('allows cancelling a scheduled post', async () => {
    const svc = setup();
    const d = await svc.draft('test-account', 'Original');
    const a = await svc.approve(d.id, d.revision, 'KZ');
    const s = await svc.schedule(d.id, a.revision, tomorrow());
    const c = await svc.cancel(d.id, s.revision);
    expect(c.status).toBe('CANCELLED');
    expect(c.scheduledAt).toBeUndefined();
  });
});
