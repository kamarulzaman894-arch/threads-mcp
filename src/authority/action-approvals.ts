import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { digestWritePayload, type KZWriteApprovalRequest, type KZWriteApprovalValidator } from './write-approval.js';

export interface ApprovalKV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, seconds: number): Promise<boolean>;
  getDel(key: string): Promise<string | null>;
}
type RecordState = 'pending' | 'approved';
interface RecordData {
  action: string;
  payloadDigest: string;
  userId: string;
  summary: string;
  issued: number;
  expires: number;
  status: RecordState;
}
const PREFIX = 'kz:threads:write-approval:v1:';
const TTL_SECONDS = 600;
const REF_PATTERN = /^[a-f0-9]{48}$/;

function safeMatchHex(digest: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expected)) return false;
  const a = Buffer.from(digest, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Server-side, single-use, payload-bound KZ owner approvals. */
export class KZActionApprovals {
  constructor(
    private readonly store: ApprovalKV,
    private readonly ownerHash: string,
    private readonly baseUrl: string,
    private readonly getConnectedUserId: () => string | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private key(ref: string) { return PREFIX + ref; }

  async prepare(action: string, args: unknown): Promise<{
    status: 'KZ_APPROVAL_REQUIRED';
    action: string;
    approvalRef: string;
    approvalUrl: string;
    instructions: string;
    expiresInSeconds: number;
  }> {
    const userId = this.getConnectedUserId();
    if (!userId) throw new Error('THREADS_NOT_AUTHENTICATED');
    if (!/^[a-f0-9]{64}$/i.test(this.ownerHash)) {
      throw new Error('KZ_OWNER_APPROVAL_NOT_CONFIGURED');
    }
    const payload = args && typeof args === 'object' && !Array.isArray(args)
      ? Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'approval'))
      : args;
    const ref = randomBytes(24).toString('hex');
    const issued = this.now();
    const record: RecordData = {
      action,
      payloadDigest: digestWritePayload(action, payload),
      userId,
      summary: JSON.stringify(payload).slice(0, 4000),
      issued,
      expires: issued + TTL_SECONDS * 1000,
      status: 'pending',
    };
    if (!(await this.store.set(this.key(ref), JSON.stringify(record), TTL_SECONDS))) {
      throw new Error('KZ_APPROVAL_STORE_UNAVAILABLE');
    }
    return {
      status: 'KZ_APPROVAL_REQUIRED',
      action,
      approvalRef: ref,
      approvalUrl: this.baseUrl + '/actions/review?ref=' + ref,
      instructions: 'Open approvalUrl, review exact action, enter the private KZ owner key and approve. Then repeat this same tool call with exactly the same arguments plus approval: {approved:true, approvedBy:"KZ", approvalRef}. No post will be sent before that final approved call.',
      expiresInSeconds: TTL_SECONDS,
    };
  }

  async getPending(ref: string): Promise<RecordData | null> {
    if (!REF_PATTERN.test(ref)) return null;
    const raw = await this.store.get(this.key(ref));
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as RecordData;
      if (p.expires <= this.now()) return null;
      return p;
    } catch { return null; }
  }

  async ownerApprove(ref: string, ownerKey: string): Promise<boolean> {
    if (!REF_PATTERN.test(ref)) return false;
    const digest = createHash('sha256').update(ownerKey).digest('hex');
    if (!safeMatchHex(digest, this.ownerHash)) return false;
    const pending = await this.getPending(ref);
    if (!pending || pending.status !== 'pending' ||
        pending.userId !== this.getConnectedUserId()) return false;
    pending.status = 'approved';
    const remaining = Math.ceil((pending.expires - this.now()) / 1000);
    if (remaining <= 0) return false;
    return this.store.set(this.key(ref), JSON.stringify(pending), remaining);
  }

  validator(): KZWriteApprovalValidator {
    return {
      validate: async (request: KZWriteApprovalRequest) => {
        const ref = request.approval?.approvalRef;
        if (!ref || !REF_PATTERN.test(ref) || !request.payloadDigest) return false;
        const first = await this.getPending(ref);
        if (!first || first.status !== 'approved') return false;
        // GETDEL atomically consumes the authorization exactly once.
        const consumed = await this.store.getDel(this.key(ref));
        if (!consumed) return false;
        let record: RecordData;
        try { record = JSON.parse(consumed) as RecordData; }
        catch { return false; }
        return record.status === 'approved' &&
          record.expires > this.now() &&
          record.action === request.action &&
          record.userId === this.getConnectedUserId() &&
          record.payloadDigest === request.payloadDigest;
      },
    };
  }
}
