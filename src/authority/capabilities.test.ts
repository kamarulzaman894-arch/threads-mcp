import { describe, expect, it } from 'vitest';
import { TOOL_CAPABILITIES, READ_TOOL_NAMES, WRITE_TOOL_NAMES, classifyMetaApiFailure } from './capabilities.js';

describe('canonical Threads tool contract', () => {
  it('has 28 unique tools: 18 reads and 10 writes', () => {
    expect(TOOL_CAPABILITIES).toHaveLength(28);
    expect(new Set(TOOL_CAPABILITIES.map((t) => t.name)).size).toBe(28);
    expect(READ_TOOL_NAMES.size).toBe(18);
    expect(WRITE_TOOL_NAMES.size).toBe(10);
    for (const read of READ_TOOL_NAMES) expect(WRITE_TOOL_NAMES.has(read)).toBe(false);
  });
  it('identifies Meta permission and token failures without promising access', () => {
    expect(classifyMetaApiFailure({ code: 10, error_subcode: 4279067 })).toBe('META_PERMISSION_REQUIRED');
    expect(classifyMetaApiFailure({ code: 190 })).toBe('META_TOKEN_INVALID');
    expect(classifyMetaApiFailure({ code: 4 })).toBe('META_RATE_LIMITED');
    expect(classifyMetaApiFailure({ code: 100 })).toBe('META_API_ERROR');
  });
});
