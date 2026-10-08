/**
 * Canonical 26-tool inventory for KZ Threads MCP.
 *
 * Exposing a tool is not proof of Meta permission, approval or runtime readiness.
 * Mutations remain blocked remotely until human approval is verified server-side.
 */
export const TOOL_CAPABILITIES = [
  { name: 'threads_get_profile', mode: 'read', scope: 'threads_basic' },
  { name: 'threads_get_threads', mode: 'read', scope: 'threads_basic' },
  { name: 'threads_list_my_replies', mode: 'read', scope: 'threads_basic' },
  { name: 'threads_get_public_profile_posts', mode: 'read', scope: 'threads_profile_discovery' },
  { name: 'threads_get_publishing_limit', mode: 'read', scope: 'threads_content_publish' },
  { name: 'threads_get_container_status', mode: 'read', scope: 'threads_content_publish' },
  { name: 'threads_get_account_insights', mode: 'read', scope: 'threads_manage_insights' },
  { name: 'threads_get_thread', mode: 'read', scope: 'threads_basic' },
  { name: 'threads_search', mode: 'read', scope: 'threads_keyword_search' },
  { name: 'threads_get_mentions', mode: 'read', scope: 'threads_manage_mentions' },
  { name: 'threads_profile_lookup', mode: 'read', scope: 'threads_profile_discovery' },
  { name: 'threads_search_locations', mode: 'read', scope: 'threads_location_tagging' },
  { name: 'threads_get_location', mode: 'read', scope: 'threads_location_tagging' },
  { name: 'threads_get_insights', mode: 'read', scope: 'threads_manage_insights' },
  { name: 'threads_get_replies', mode: 'read', scope: 'threads_read_replies' },
  { name: 'threads_get_conversation', mode: 'read', scope: 'threads_read_replies' },
  { name: 'threads_create_video_container', mode: 'write', scope: 'threads_content_publish' },
  { name: 'threads_create_carousel_post', mode: 'write', scope: 'threads_content_publish' },
  { name: 'threads_publish_container', mode: 'write', scope: 'threads_content_publish' },
  { name: 'threads_quote_thread', mode: 'write', scope: 'threads_content_publish' },
  { name: 'threads_create_thread', mode: 'write', scope: 'threads_content_publish' },
  { name: 'threads_reply_to_thread', mode: 'write', scope: 'threads_content_publish' },
  { name: 'threads_repost_thread', mode: 'write', scope: 'threads_content_publish' },
  { name: 'threads_delete_thread', mode: 'write', scope: 'threads_delete' },
  { name: 'threads_manage_reply', mode: 'write', scope: 'threads_manage_replies' },
  { name: 'threads_manage_pending_reply', mode: 'write', scope: 'threads_manage_replies' },
] as const;

export const READ_TOOL_NAMES = new Set<string>(
  TOOL_CAPABILITIES.filter((tool) => tool.mode === 'read').map((tool) => tool.name),
);
export const WRITE_TOOL_NAMES = new Set<string>(
  TOOL_CAPABILITIES.filter((tool) => tool.mode === 'write').map((tool) => tool.name),
);

export function classifyMetaApiFailure(error: {
  code?: number;
  error_subcode?: number;
  message?: string;
}): 'META_PERMISSION_REQUIRED' | 'META_TOKEN_INVALID' | 'META_RATE_LIMITED' | 'META_API_ERROR' {
  if (error.code === 10 || error.error_subcode === 4279067) return 'META_PERMISSION_REQUIRED';
  if (error.code === 190 || error.code === 102) return 'META_TOKEN_INVALID';
  if ([4, 17, 32, 613].includes(error.code ?? -1)) return 'META_RATE_LIMITED';
  return 'META_API_ERROR';
}
