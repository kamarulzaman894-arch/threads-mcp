# KZ Threads MCP — Approval-First Scheduling V1 (STAGING ONLY)

## Scope and separation
- THRIVE OS writes the draft and content recommendations, but never owns OAuth/tokens.
- KZ Threads MCP stores approval and scheduling state in its own service.
- This branch is isolated from Render deployment branch `kz-cloud-oauth-v1`.
- Current production remains read-only. No autonomous polling, timer, or publishing route is enabled.

## State transitions
DRAFT -> APPROVED (KZ) -> SCHEDULED -> PUBLISHING -> PUBLISHED.
Editing an approved/scheduled post returns it to DRAFT and invalidates approval.
Cancellation of drafts, approvals and scheduled posts is allowed.

## Required production work before activation
1. Authentication: replace the sample actor string with an authenticated, session-bound KZ identity; don't trust user-provided `approvedBy`.
2. Storage: durable database implementation of atomic compare-and-swap and unique idempotency claim.
3. Dispatch: independent worker, persistent jobs, timezone-aware schedule, concurrency lock, bounded retry. Require fail-closed on uncertain publish results; reconcile by platform ID before retry to prevent duplicate posts.
4. API write gate: enforce the human approval and content-hash checks at the final Threads API side-effect boundary, not just in scheduling.
5. Permissions: verify `threads_content_publish` on the active token and Meta App Review access. Scopes listed in code do not prove the token has them.
6. Test in an isolated non-production environment with explicit human approval for any real Threads post; never publish a 'test' without permission.
7. Confirm logged schedule, due time, successful publication and audit record. Verify reject, cancel, edit, retry and duplicate behavior.
8. KZ must explicitly approve production write activation after tests. Default flags stay `productionReadOnly=true`, `writeTestsPassed=false`, `humanWriteEnablement=false`.

## Current deliverables
- `src/scheduling/scheduled-publishing.ts`: draft, revise, approve, schedule, cancel, due-claim, fail-closed gate
- `src/scheduling/scheduled-publishing.test.ts`: regression cases (committed, not yet executed by CI)

## Non-claims
This staging component does NOT schedule a timer or automatically publish a real post.
No public write tool has been registered and production behavior is unchanged.
