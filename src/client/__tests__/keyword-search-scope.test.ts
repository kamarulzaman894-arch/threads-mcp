import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { ThreadsClient } from '../threads-client.js';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);
const get = vi.fn();
const interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };

describe('keyword-search result scope and token safety', () => {
  let client: ThreadsClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.create.mockReturnValue({ get, interceptors } as any);
    client = new ThreadsClient({ accessToken: 'secret-token', userId: 'me' });
    get.mockImplementation(async (path: string) => {
      if (path === '/me') return { data: { id: 'me', username: 'kzbinzainal' } };
      throw new Error('Unexpected endpoint: ' + path);
    });
  });

  it('flags self-owned-only results and strips token-bearing paging URLs', async () => {
    get.mockImplementation(async (path: string) => path === '/me'
      ? { data: { id: 'me', username: 'kzbinzainal' } }
      : { data: { data: [{ id: '1', username: 'kzbinzainal' }],
        paging: { next: 'https://graph.threads.net/v1.0/keyword_search?access_token=secret-token',
          cursors: { after: 'opaque-cursor' } } } });
    const result = await client.searchThreads('marketing') as any;
    expect(result.search_metadata.visibility).toBe('OWN_ACCOUNT_ONLY_OBSERVED');
    expect(result.search_metadata.public_search_verified).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(result.paging.cursors.after).toBe('opaque-cursor');
  });

  it('verifies external authors only when a different username is actually returned', async () => {
    get.mockImplementation(async (path: string) => path === '/me'
      ? { data: { id: 'me', username: 'kzbinzainal' } }
      : { data: { data: [{ id: '2', username: 'another_marketer' }] } });
    const result = await client.searchThreads('sales') as any;
    expect(result.search_metadata.visibility).toBe('PUBLIC_AUTHORS_OBSERVED');
    expect(result.search_metadata.public_search_verified).toBe(true);
  });

  it('leaves zero-result searches unverified', async () => {
    get.mockImplementation(async (path: string) => path === '/me'
      ? { data: { id: 'me', username: 'kzbinzainal' } }
      : { data: { data: [] } });
    const result = await client.searchThreads('niche keyword') as any;
    expect(result.search_metadata.visibility).toBe('UNVERIFIED');
    expect(result.search_metadata.public_search_verified).toBe(false);
  });

  it('requests username even when custom fields omit author identity', async () => {
    get.mockImplementation(async (path: string) => path === '/me'
      ? { data: { id: 'me', username: 'kzbinzainal' } }
      : { data: { data: [] } });
    await client.searchThreads('marketing', { fields: ['text'] });
    expect(get).toHaveBeenCalledWith('/keyword_search', {
      params: expect.objectContaining({ fields: 'id,username,text' }),
    });
  });
});
