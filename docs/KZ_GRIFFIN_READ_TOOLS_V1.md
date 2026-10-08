# KZ Threads MCP — Griffin Read Capabilities V1

## Why this exists
Reference repository: https://github.com/griffinwork40/threads-mcp

The third-party project is a 26-tool stdio MCP server for Meta Threads API. It was reviewed as a feature reference, **not copied** into this repository. It has no license file shown in the reviewed public repository, so new code here is independently implemented using documented Meta endpoints.

KZ already runs a separate remote MCP based on the existing threads-mcp repository. Replace neither THRIVE OS nor the production branch with the third-party server.

## Additive read-only tools
- `threads_list_my_replies`: authenticated user's replies, cursor and limit support. API `/{user-id}/replies`.
- `threads_get_public_profile_posts`: posts of exact public username; **requires approval / permissions for profile discovery**. API `/profile_posts?username=...`.
- `threads_get_publishing_limit`: quota usage via `/{user-id}/threads_publishing_limit`. Does not publish.

Existing tools continue to handle profile, own posts, individual post, search, mentions, lookup, location, insights, replies, conversations.

## Guardrails
- Remote HTTPS MCP endpoint continues to expose **only 14 read tools** (previously 11). The internal human-controlled server contains 20 definitions: 14 reads, 6 explicit-approval writes.
- No new write path is enabled, and no autonomous publishing is enabled.
- Keyword search and profile discovery depend on *actual Meta permissions*; tool presence doesn't guarantee access.
- Existing OAuth and token flows retained without change.
- Existing Render production branch `kz-cloud-oauth-v1` left untouched.
- Existing THRIVE OS stays an independent content/intelligence layer. KZ Threads MCP owns Meta connectivity.

## Validation
- Unit tests assert full server tool count and read-only allowlist.
- Live MCP smoke test expected read-only count updated to 14.
- **Before production:** `pnpm install --frozen-lockfile && pnpm run build && pnpm test`, and confirm successful Meta OAuth + live calls for own posts, replies, insights, and capability-gated public-posts.
- Do not merge/deploy without CI green and owner review.

## Meta documentation
- https://www.postman.com/meta/threads/request/34203612-b02f08fa-a8c3-4b9c-9848-e83e95a1e237
- https://www.postman.com/meta/threads/request/34203612-116161fc-75af-4a09-a972-66d6f64ddb10
- https://www.postman.com/meta/threads/request/7evieur/retrieve-publishing-quota-limit
