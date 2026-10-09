import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validOauthOwnerKey, sameConnectedThreadsAccount } from './oauth-owner-gate.js';

describe('KZ Threads owner-only reauthorization', () => {
  const ownerKey = 'owner-key-used-only-for-test';
  const ownerHash = createHash('sha256').update(ownerKey).digest('hex');

  it('allows only the exact owner secret', () => {
    expect(validOauthOwnerKey(ownerKey, ownerHash)).toBe(true);
    expect(validOauthOwnerKey('wrong', ownerHash)).toBe(false);
    expect(validOauthOwnerKey('', ownerHash)).toBe(false);
    expect(validOauthOwnerKey(ownerKey, '')).toBe(false);
    expect(validOauthOwnerKey(ownerKey, 'x'.repeat(64))).toBe(false);
    expect(validOauthOwnerKey('x'.repeat(4097), ownerHash)).toBe(false);
  });

  it('keeps reconnect bound to the currently connected account', () => {
    expect(sameConnectedThreadsAccount('kz-user', 'kz-user')).toBe(true);
    expect(sameConnectedThreadsAccount('kz-user', 'other-user')).toBe(false);
    expect(sameConnectedThreadsAccount('kz-user', '')).toBe(false);
    expect(sameConnectedThreadsAccount(null, 'first-user')).toBe(true);
  });
});
