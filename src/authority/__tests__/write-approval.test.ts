import { describe, it, expect, vi } from 'vitest';
import {
  assertKZWriteApproval,
  type KZWriteApproval,
  type KZWriteApprovalValidator,
} from '../write-approval.js';

const approval: KZWriteApproval = {
  approved: true,
  approvedBy: 'KZ',
  approvalRef: 'approval-001',
};

describe('KZ write approval authority', () => {
  it('denies write when no host validator is configured', async () => {
    await expect(
      assertKZWriteApproval(undefined, {
        action: 'threads_create_thread',
        approval,
      })
    ).rejects.toThrow('approvalRef was not validated');
  });

  it('denies write when host validator rejects approval', async () => {
    const validator: KZWriteApprovalValidator = {
      validate: vi.fn().mockResolvedValue(false),
    };

    await expect(
      assertKZWriteApproval(validator, {
        action: 'threads_delete_thread',
        approval,
        targetId: 'thread-1',
      })
    ).rejects.toThrow('approvalRef was not validated');
  });

  it('allows write only when host validator validates KZ approval', async () => {
    const validator: KZWriteApprovalValidator = {
      validate: vi.fn().mockResolvedValue(true),
    };

    await expect(
      assertKZWriteApproval(validator, {
        action: 'threads_manage_reply',
        approval,
        targetId: 'reply-1',
      })
    ).resolves.toBeUndefined();

    expect(validator.validate).toHaveBeenCalledWith({
      action: 'threads_manage_reply',
      approval,
      targetId: 'reply-1',
    });
  });
});
