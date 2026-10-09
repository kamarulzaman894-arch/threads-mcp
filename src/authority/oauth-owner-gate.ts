import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Only KZ may initiate a new Threads OAuth grant.
 * Owner key is submitted in a POST body, never in a URL or a server log.
 */
export function validOauthOwnerKey(ownerKey: string, configuredHash: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(configuredHash) || !ownerKey || ownerKey.length > 4096) {
    return false;
  }
  const supplied = createHash('sha256').update(ownerKey).digest();
  const expected = Buffer.from(configuredHash, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** A reauthorization must not silently switch the connected Threads account. */
export function sameConnectedThreadsAccount(currentId: string | null | undefined, authorizedId: string): boolean {
  return !currentId || (!!authorizedId && currentId === authorizedId);
}
