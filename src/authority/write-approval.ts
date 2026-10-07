export interface KZWriteApproval {
  approved: true;
  approvedBy: 'KZ';
  approvalRef: string;
}

export function assertKZWriteApproval(
  approval: KZWriteApproval | undefined
): asserts approval is KZWriteApproval {
  if (
    !approval ||
    approval.approved !== true ||
    approval.approvedBy !== 'KZ' ||
    !approval.approvalRef ||
    approval.approvalRef.trim().length === 0
  ) {
    throw new Error(
      'KZ explicit approval required for Threads write action. Provide approved=true, approvedBy=KZ, and a non-empty approvalRef.'
    );
  }
}
