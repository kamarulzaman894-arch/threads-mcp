# KZ Threads MCP — Read-Only Lock

Base upstream: `quinnjr/threads-mcp`

Phase 1 purpose: expose Meta Threads read data only.

Independent consumers:
- TIA = specialist agent inside KZ MARS OS
- THRIVE OS = standalone Threads operating system

There is no TIA -> THRIVE dependency.

Allowed MCP tools:
- threads_get_profile
- threads_get_threads
- threads_get_thread
- threads_get_insights
- threads_get_replies
- threads_get_conversation

Removed MCP tools:
- threads_create_thread
- threads_reply_to_thread

Allowed OAuth scopes:
- threads_basic
- threads_read_replies
- threads_manage_insights

Removed OAuth scopes:
- threads_content_publish
- threads_manage_replies

No publish, reply-write, delete, moderation-write, browser-cookie automation, or unofficial Threads API path is authorized in Phase 1.

CI enforcement: GitHub Actions runs pnpm install, build, and test on kz-readonly-v1.
