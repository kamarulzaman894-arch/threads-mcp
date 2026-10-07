# KZ Threads MCP — Human-Controlled V2

Status: architecture + code implementation candidate. Production promotion requires CI PASS and live Meta OAuth/runtime verification.

## Authority model

- READ / ANALYZE / SEARCH / DISCOVERY: allowed without write approval.
- WRITE / PUBLISH / REPLY / REPOST / DELETE / MODERATE: requires explicit KZ approval.
- A tool argument alone is not authority.
- Every write call must include a KZ approval object AND pass a host/runtime approval validator.
- If the host does not configure a validator, write actions fail closed.
- AUTONOMOUS_PUBLISH = FALSE.
- AUTONOMOUS_WRITE = FALSE.

## OAuth capability scopes

- threads_basic
- threads_content_publish
- threads_manage_insights
- threads_manage_replies
- threads_read_replies
- threads_keyword_search
- threads_manage_mentions
- threads_delete
- threads_location_tagging
- threads_profile_discovery

OAuth capability does not grant execution authority.

## Read / discovery tools

1. threads_get_profile
2. threads_get_threads
3. threads_get_thread
4. threads_search
5. threads_get_mentions
6. threads_profile_lookup
7. threads_search_locations
8. threads_get_location
9. threads_get_insights
10. threads_get_replies
11. threads_get_conversation

## Write tools — approval required

1. threads_create_thread
2. threads_reply_to_thread
3. threads_repost_thread
4. threads_delete_thread
5. threads_manage_reply
6. threads_manage_pending_reply

## Primary runtime routing

ChatGPT
→ THRIVE OS (primary Threads operating layer)
→ KZ Threads MCP Human-Controlled V2
→ Official Meta Threads API

TIA is optional, not part of the required runtime path.

When specialist Threads intelligence from KZ MARS OS is needed, ChatGPT/THRIVE may escalate to TIA. THRIVE OS does not depend on TIA, and TIA is not the parent, backend, or mandatory gateway for THRIVE.

## Promotion gates

- TypeScript build PASS
- Test suite PASS
- Approval-deny regression PASS
- OAuth scope regression PASS
- CodeQL PASS
- GitHub Actions workflow must complete on the V2 branch/PR before merge
- Live OAuth PASS
- Live read smoke tests PASS
- Explicit write approval smoke test PASS before any production write
