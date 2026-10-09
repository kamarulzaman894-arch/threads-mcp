import { AsyncLocalStorage } from 'node:async_hooks';
import type { KZWriteApprovalValidator } from './write-approval.js';

interface ExecutionScope { action: string; approvalRef: string; }
export const writeExecutionContext = new AsyncLocalStorage<ExecutionScope>();

/** The client may write ONLY inside a server-validated, per-tool-call scope. */
export const executionOnlyWriteValidator: KZWriteApprovalValidator = {
  async validate(request) {
    const execution = writeExecutionContext.getStore();
    return !!execution &&
      execution.action === request.action &&
      execution.approvalRef === request.approval.approvalRef &&
      request.approval.approved === true &&
      request.approval.approvedBy === 'KZ';
  },
};
