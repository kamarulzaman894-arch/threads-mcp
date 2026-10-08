import { describe, expect, it } from 'vitest';
import { previewDue } from './due-preview.js';
import type { ScheduledPost } from './scheduled-publishing.js';
const base: ScheduledPost = {
 id:'example-id',accountId:'test',text:'Hello',contentHash:'hash',revision:3,
 status:'SCHEDULED',approvedBy:'KZ',approvedRevision:3,scheduledAt:'2026-10-01T10:00:00Z'
};
describe('dry-run scheduler',()=>{
 it('flags approved due posts for review, without publishing',()=>{
   const result=previewDue([base],new Date('2026-10-02T10:00:00Z'));
   expect(result[0].decision).toBe('ELIGIBLE_FOR_REVIEW');
 });
 it('skips edited or unapproved revisions',()=>{
   expect(previewDue([{...base,approvedRevision:2}],new Date('2026-10-02T10:00:00Z'))[0].decision).toBe('SKIP');
 });
 it('skips future posts',()=>{
   expect(previewDue([base],new Date('2026-09-30T10:00:00Z'))[0].decision).toBe('SKIP');
 });
});
