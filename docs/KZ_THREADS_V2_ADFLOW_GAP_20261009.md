# KZ Threads MCP V2 — AdFlow gap upgrade (review build)

**Scope:** Additive, read-first. No production deployment. No change to existing human approval contract.

## New read tools
- `threads_get_profile_comments`: Bounded read of own-account comments across a maximum of 10 posts per sweep, with `limit`, `since`, `until`, `depth=top|all`, `includeOwn`, and opaque continuation cursor `after`. It uses multiple Graph API calls, unlike AdFlow's server-side aggregation. `meta.truncated` and `meta.next` tell callers to continue. Do not confuse partial output with a complete inbox. Old-post comments only appear when the old post is included in the scan.
- `threads_get_pending_replies`: Read pending replies for one owned post.
- `threads_get_publishing_limit`: Read live Meta quota metrics.

## Existing security boundaries
- No new write tools, no new publishing automation.
- The existing server-side `writeApprovalValidator` is still required for every existing write method.
- Public profile and keyword discovery still depend on Meta permissions and may return OAuthException 10. This patch does not bypass them.

## Verification plan
1. Run `pnpm install`, `pnpm build`, `pnpm test` on feature branch.
2. With a Meta test account, read pending replies for an owned post and inspect whether API fields are accepted.
3. Read profile comments with `limit=5`, resume all cursors; compare coverage with individual post comments.
4. Test `depth=top` vs `depth=all`; confirm self-replies excluded if `includeOwn=false`.
5. Test invalid cursor, reversed date window, quota read errors, pagination with 10+ posts.
6. Validate live MCP tool list after merging, then perform isolated read-only smoke test.
7. Check Meta App Review for `threads_profile_discovery` and `threads_keyword_search` separately.

**Release status:** Proposed GitHub changes only. Production/connector activation remains blocked until CI, functional verification, owner review and canonical commit.
