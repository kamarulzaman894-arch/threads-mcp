/**
 * KZ Threads scheduled publishing V1 — staging-only domain layer.
 * No HTTP route, timer, or production write path is registered here.
 * All methods are explicit human-triggered transitions.
 */
import { createHash, randomUUID } from 'crypto';

export type ScheduledStatus =
  | 'DRAFT' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHING'
  | 'PUBLISHED' | 'CANCELLED' | 'FAILED_REVIEW_REQUIRED';

export type ScheduledPost = {
  id: string;
  accountId: string;
  text: string;
  contentHash: string;
  revision: number;
  status: ScheduledStatus;
  approvedBy?: string;
  approvedAt?: string;
  approvedRevision?: number;
  scheduledAt?: string;
  publishedId?: string;
  lastError?: string;
};

export interface ScheduledPostStore {
  get(id: string): Promise<ScheduledPost | null>;
  insert(post: ScheduledPost): Promise<void>;
  /** MUST be atomic, compare-and-swap in durable storage, across workers. */
  compareAndSwap(id: string, expectedRevision: number, post: ScheduledPost): Promise<boolean>;
}

export type PublishGate = {
  productionReadOnly: boolean;
  writeTestsPassed: boolean;
  humanWriteEnablement: boolean;
};

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
function validText(text: string): string {
  const value = text.trim();
  if (!value || value.length > 500) throw Error('INVALID_POST_TEXT');
  return value;
}
function assertRevision(post: ScheduledPost, expectedRevision: number): void {
  if (post.revision !== expectedRevision) throw Error('STALE_REVISION');
}
function assertEditable(post: ScheduledPost): void {
  if (post.status === 'PUBLISHED' || post.status === 'PUBLISHING') throw Error('POST_LOCKED');
}

export class ScheduledPublishingService {
  constructor(private readonly store: ScheduledPostStore) {}

  async draft(accountId: string, text: string): Promise<ScheduledPost> {
    if (!accountId.trim()) throw Error('ACCOUNT_REQUIRED');
    const body = validText(text);
    const post: ScheduledPost = {
      id: randomUUID(), accountId, text: body, contentHash: hash(body),
      revision: 1, status: 'DRAFT',
    };
    await this.store.insert(post);
    return post;
  }

  async revise(id: string, expectedRevision: number, text: string): Promise<ScheduledPost> {
    const current = await this.load(id);
    assertRevision(current, expectedRevision);
    assertEditable(current);
    const body = validText(text);
    const updated: ScheduledPost = {
      ...current, text: body, contentHash: hash(body),
      revision: current.revision + 1, status: 'DRAFT',
      approvedBy: undefined, approvedAt: undefined, approvedRevision: undefined,
      scheduledAt: undefined, lastError: undefined,
    };
    await this.save(current, updated);
    return updated;
  }

  async approve(id: string, expectedRevision: number, actor: string): Promise<ScheduledPost> {
    if (!actor.trim() || actor !== 'KZ') throw Error('KZ_APPROVAL_REQUIRED');
    const current = await this.load(id);
    assertRevision(current, expectedRevision);
    if (current.status !== 'DRAFT') throw Error('DRAFT_REQUIRED');
    const updated: ScheduledPost = {
      ...current, status: 'APPROVED', revision: current.revision + 1,
      approvedBy: actor, approvedAt: new Date().toISOString(),
      approvedRevision: current.revision + 1,
    };
    await this.save(current, updated);
    return updated;
  }

  async schedule(id: string, expectedRevision: number, scheduledAt: string): Promise<ScheduledPost> {
    const current = await this.load(id);
    assertRevision(current, expectedRevision);
    if (current.status !== 'APPROVED' || current.approvedBy !== 'KZ' ||
        current.approvedRevision !== current.revision) throw Error('APPROVAL_REQUIRED');
    const at = new Date(scheduledAt);
    if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) throw Error('FUTURE_TIME_REQUIRED');
    const updated: ScheduledPost = {
      ...current, status: 'SCHEDULED', scheduledAt: at.toISOString(),
      revision: current.revision + 1, approvedRevision: current.revision + 1,
    };
    await this.save(current, updated);
    return updated;
  }

  async cancel(id: string, expectedRevision: number): Promise<ScheduledPost> {
    const current = await this.load(id);
    assertRevision(current, expectedRevision);
    assertEditable(current);
    const updated: ScheduledPost = {
      ...current, status: 'CANCELLED', revision: current.revision + 1,
      scheduledAt: undefined, approvedBy: undefined,
      approvedRevision: undefined, approvedAt: undefined,
    };
    await this.save(current, updated);
    return updated;
  }

  /**
   * A production worker may only enter this state after separate write-testing,
   * documented human enablement and an explicit durable CAS claim.
   * This function DOES NOT invoke the Threads API or launch an autonomous worker.
   */
  async claimDue(id: string, expectedRevision: number, now: Date, gate: PublishGate): Promise<ScheduledPost> {
    if (gate.productionReadOnly || !gate.writeTestsPassed || !gate.humanWriteEnablement)
      throw Error('PRODUCTION_WRITE_DISABLED');
    const current = await this.load(id);
    assertRevision(current, expectedRevision);
    if (current.status !== 'SCHEDULED' || current.approvedBy !== 'KZ' ||
        current.approvedRevision !== current.revision ||
        current.contentHash !== hash(current.text) || !current.scheduledAt ||
        Date.parse(current.scheduledAt) > now.getTime()) throw Error('NOT_APPROVED_OR_NOT_DUE');
    const updated: ScheduledPost = {
      ...current, status: 'PUBLISHING', revision: current.revision + 1,
      approvedRevision: current.revision + 1,
    };
    await this.save(current, updated);
    return updated;
  }

  private async load(id: string): Promise<ScheduledPost> {
    const result = await this.store.get(id);
    if (!result) throw Error('POST_NOT_FOUND');
    return result;
  }
  private async save(before: ScheduledPost, after: ScheduledPost): Promise<void> {
    if (!await this.store.compareAndSwap(before.id, before.revision, after))
      throw Error('CONCURRENT_CHANGE');
  }
}
