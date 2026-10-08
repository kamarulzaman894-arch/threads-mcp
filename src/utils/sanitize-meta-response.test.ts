import { describe, expect, it } from 'vitest';
import { sanitizeMetaResponse } from './sanitize-meta-response.js';

describe('Meta response secret redaction', () => {
  it('redacts paging.next access tokens while preserving paging cursors and public post data', () => {
    const input = {
      data: [{ id: '123', text: 'marketing', username: 'publicuser' }],
      paging: {
        next: 'https://graph.threads.net/v1.0/keyword_search?q=marketing&access_token=TOP_SECRET&after=nextCursor',
        cursors: { after: 'nextCursor' },
      },
    };
    const actual = sanitizeMetaResponse(input);
    expect(JSON.stringify(actual)).not.toContain('TOP_SECRET');
    expect(actual.paging.cursors.after).toBe('nextCursor');
    expect(actual.data[0].text).toBe('marketing');
    expect(input.paging.next).toContain('TOP_SECRET');
  });

  it('redacts nested token fields and sensitive URLs in text', () => {
    const actual = sanitizeMetaResponse({
      access_token: 'NEVER_RETURN_THIS',
      nested: [{ client_secret: 'ALSO_SECRET', message: 'url?access_token=HIDDEN&cursor=ok' }],
    });
    const s = JSON.stringify(actual);
    for (const secret of ['NEVER_RETURN_THIS', 'ALSO_SECRET', 'HIDDEN']) {
      expect(s).not.toContain(secret);
    }
    expect(s).toContain('cursor=ok');
  });
});
