# KZ Threads MCP V2 — Production Release Gate

**Base:** `kz-cloud-oauth-v1`, Render service `srv-db398pnlot8c73f1pk00`
**Live URL:** `https://kz-threads-mcp.onrender.com/mcp`
**Current deployed baseline:** `bef8b72ff7e7a5241238be9df1b23930391de63d`

## Scope and non-scope

Adds only `threads_get_profile_comments` and `threads_get_pending_replies` as READ tools, bringing the existing contract from 16 read + 10 write to 18 read + 10 write. `threads_get_publishing_limit` is already in production; do not add a duplicate. No Meta write calls, no publishing automation and no changes to the Redis/OAuth approval authority.

## Evidence available

- Earlier cloud-bound CI and CodeQL passed for commit `02d51f85fbc13dcc267f9d4fdaefadea22cbf413`.
- Real connected Meta account `@kzbinzainal` returned own posts and replies with pagination **cursors but no paging.next**. V2 includes a regression for cursor-only paging.
- Official Meta Threads API Postman collection describes `GET /{thread_id}/pending_replies` with `approval_status=pending`.
- A successful mocked `getPendingReplies` unit test does **not** demonstrate real Meta permission or availability.

## Mandatory proof before production deployment

1. Verify current commit CI and CodeQL both succeed, and PR still targets `kz-cloud-oauth-v1` with no unexpected changes to write authority.
2. Obtain **authorized staging or isolated read-only API execution** with the real linked account. Confirm `GET /{owned_thread_id}/pending_replies?approval_status=pending`, including valid empty list or permission error classification. Do not create or approve a reply just to make the endpoint return data.
3. Run `threads_get_profile_comments` on owner posts with `limit=1`, follow `meta.next`, verify pagination, own-reply exclusion, and compare against independent post-reply reads. Account for legitimate data changes between pages.
4. Verify total tools in new server: **28**, exactly **18 READ + 10 gated WRITE**; no missing legacy tools. Verify all 10 WRITE tools retain server-side one-time approval validation and replay protection.
5. Confirm cloud self-test, token redaction and OAuth after deploying to a staging service or under an explicitly approved controlled rollout. Never turn a read smoke test into a Threads write.
6. Confirm Render still targets `kz-cloud-oauth-v1` and has `autoDeploy=yes`. **Merging to that branch automatically deploys to the live service**; do not merge for a preview.
7. If live production rollout later approved, record deployment ID/commit SHA, check `/mcp` own-profile read, compare old/new capability names, and inspect errors. Roll back to `bef8b72ff7e7a5241238be9df1b23930391de63d` (or newer known-good deployed SHA) if the service degrades.

## Known limitations

- `threads_get_profile_comments` is a bounded, multi-call, **partial** inbox scan (max 10 owned posts per pass). A next cursor means more pages **may** be available; it is not proof there are matching comments. Date filtering applies to reply timestamps, not post timestamps; older posts must be traversed to find recent comments left on them.
- Cursor-only Meta pagination has been observed, but whether every cursor refers to a new page needs testing with live permissions. Clients must stop on missing `meta.next` and deduplicate by comment ID if aggregating repeated scans.
- `threads_get_pending_replies` needs the relevant Meta approval/replies permissions. Public competitor discovery/keyword search is unchanged and still permission-gated.
- Approval-controlled WRITE is not autonomous publication. A successful server-side one-time KZ approval is required for every write.

## Release decision

**HOLD FOR LIVE VALIDATION.** Passing unit tests, CI and CodeQL alone is insufficient to establish complete safe production behavior. No merge to `kz-cloud-oauth-v1` until the above gates pass and an authorized production change is approved.
