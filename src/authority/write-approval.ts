export interface KZWriteApproval {
  approved: true;
  approvedBy: 'KZ';
  approvalRef: string;
}

export interface KZWriteApprovalRequest {
  action: string;
  approval: KZWriteApproval;
  targetId?: string;
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
