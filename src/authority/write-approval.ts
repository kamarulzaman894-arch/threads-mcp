import { createHash } from 'node:crypto';
export interface KZWriteApproval {
  approved: true;
  approvedBy: 'KZ';
  approvalRef: string;
}

export interface KZWriteApprovalRequest {
  action: string;
  approval: KZWriteApproval;
  targetId?: string;
  payloadDigest?: string;
}

export interface KZWriteApprovalValidator {
  validate(request: KZWriteApprovalRequest): Promise<boolean>;
}

export const denyAllWriteApprovalValidator: KZWriteApprovalValidator = {
  async validate() {
    return false;
  },
};

export async function assertKZWriteApproval(
  validator: KZWriteApprovalValidator | undefined,
  request: KZWriteApprovalRequest
): Promise<void> {
  const approval = request.approval;

  if (
    !approval ||
    approval.approved !== true ||
    approval.approvedBy !== 'KZ' ||
    !approval.approvalRef ||
    approval.approvalRef.trim().length === 0
  ) {
    throw new Error(
      'KZ explicit approval required for Threads write action.'
    );
  }

  const isValid = await (validator ?? denyAllWriteApprovalValidator).validate(request);
  if (!isValid) {
    throw new Error(
      'Threads write blocked: approvalRef was not validated by the host approval authority.'
    );
  }
}

export function digestWritePayload(action: string, args: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'approval').sort(([a],[b])=>a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])
    );
    return value;
  };
  return createHash('sha256').update(JSON.stringify({ action, args: canonical(args) })).digest('hex');
}
