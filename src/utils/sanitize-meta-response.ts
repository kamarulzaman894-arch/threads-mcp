/**
 * Fail-safe output sanitizer for responses from the Threads Graph API.
 * Meta pagination URLs can contain the access_token query parameter.
 * Never return secrets to MCP clients, logs or a ChatGPT conversation.
 */
const SECRET_KEYS = new Set([
  'access_token', 'refresh_token', 'client_secret', 'app_secret',
  'authorization', 'api_key', 'api_secret',
]);

function redactString(value: string): string {
  return value
    // Standard and percent-encoded query strings (including URLs in error messages).
    .replace(/((?:access_token|refresh_token|client_secret|app_secret|api_key|api_secret)=)[^&#\\\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/((?:access_token|refresh_token|client_secret|app_secret|api_key|api_secret)%3[dD])[^%&\\\s"'<>]+/gi, '$1[REDACTED]')
    // JSON-encoded fragments in error messages.
    .replace(/("(?:access_token|refresh_token|client_secret|app_secret|api_key|api_secret)"\\s*:\\s*")[^"]+/gi, '$1[REDACTED]');
}

export function sanitizeMetaResponse<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();

  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') return redactString(node);
    if (!node || typeof node !== 'object') return node;
    if (seen.has(node)) return seen.get(node);

    if (Array.isArray(node)) {
      const cleaned: unknown[] = [];
      seen.set(node, cleaned);
      for (const item of node) cleaned.push(visit(item));
      return cleaned;
    }

    const cleaned: Record<string, unknown> = {};
    seen.set(node, cleaned);
    for (const [key, item] of Object.entries(node)) {
      cleaned[key] = SECRET_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : visit(item);
    }
    return cleaned;
  };

  return visit(value) as T;
}
