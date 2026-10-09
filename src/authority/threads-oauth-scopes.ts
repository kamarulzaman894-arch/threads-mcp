/** Separate read-only staging grants from human-approved production publishing. */
export const THREADS_READ_SCOPES = [
  'threads_basic',
  'threads_manage_insights',
  'threads_read_replies',
  'threads_keyword_search',
  'threads_manage_mentions',
  'threads_location_tagging',
  'threads_profile_discovery',
  // Meta may require this for reading the owner's pending-replies queue.
  // Tooling stays READ-only, even if the grant could authorize write APIs.
  'threads_manage_replies',
] as const;

export const THREADS_WRITE_SCOPES = [
  'threads_content_publish',
  'threads_delete',
] as const;

export function threadsOauthScopes(ownerGatedWritesEnabled: boolean): string[] {
  const scopes: string[] = [...THREADS_READ_SCOPES];
  if (ownerGatedWritesEnabled) scopes.push(...THREADS_WRITE_SCOPES);
  return scopes;
}
