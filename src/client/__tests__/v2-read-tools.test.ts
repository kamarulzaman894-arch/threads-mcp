import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { ThreadsClient } from '../threads-client.js';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);
const get = vi.fn();
const post = vi.fn();
const clientFactory = () => new ThreadsClient({ accessToken: 'test-token', userId: 'owner123' });

beforeEach(() => {
  vi.clearAllMocks();
  mockedAxios.create.mockReturnValue({
    get, post,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  } as any);
});

describe('V2 read-only tools', () => {
  it('reads pending replies without writing', async () => {
    get.mockResolvedValue({ data: { data: [{ id:'pending1' }] } });
    const result = await clientFactory().getPendingReplies({ threadId:'p1', limit:3 });
    expect(result.data[0].id).toBe('pending1');
    expect(get).toHaveBeenCalledWith('/p1/pending_replies', expect.objectContaining({
      params: expect.objectContaining({ approval_status:'pending', limit:3 })
    }));
    expect(post).not.toHaveBeenCalled();
  });
  it('fetches Meta live publishing quota without a write', async () => {
    get.mockResolvedValue({ data: { data: [{ quota_usage: 2 }] } });
    await clientFactory().getPublishingLimit();
    expect(get).toHaveBeenCalledWith('/owner123/threads_publishing_limit', expect.any(Object));
    expect(post).not.toHaveBeenCalled();
  });
  it('rejects malformed and reversed cursors without API calls', async () => {
    await expect(clientFactory().getProfileComments({ after:'not-a-cursor' })).rejects.toThrow(/Invalid comments cursor/);
    await expect(clientFactory().getProfileComments({ since:100,until:99 })).rejects.toThrow(/since/);
    await expect(clientFactory().getProfileComments({ limit:0 })).rejects.toThrow(/limit/);
    expect(get).not.toHaveBeenCalled();
  });
  it('filters own comments and returns a resumable next cursor', async () => {
    get.mockImplementation(async (path:string, config:any) => {
      if (path === '/owner123') return { data: { id:'owner123',username:'kz' } };
      if (path === '/owner123/threads') return { data: { data:[{id:'p1',permalink:'url1'},{id:'p2',permalink:'url2'}] } };
      if (path === '/p1/replies') return { data: { data:[
        {id:'r1',username:'kz',timestamp:'2026-10-08T00:00:00Z'},
        {id:'r2',username:'lead',timestamp:'2026-10-09T00:00:00Z'}
      ] } };
      if (path === '/p2/replies') return { data: { data: [{id:'r3',username:'lead',timestamp:'2026-10-09T00:00:00Z'}] } };
      throw new Error('unknown mock path: '+path);
    });
    const c = clientFactory();
    const result:any = await c.getProfileComments({limit:1, since:1791500000});
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('r2');
    expect(result.meta.next).toBeTruthy();
    const next:any = await c.getProfileComments({limit:1,after:result.meta.next});
    expect(next.data[0].id).toBe('r3');
    expect(post).not.toHaveBeenCalled();
  });
  it('supports nested conversation endpoint', async () => {
    get.mockImplementation(async (path:string) => {
      if (path === '/owner123/threads') return { data:{data:[{id:'p1'}]} };
      if (path === '/p1/conversation') return { data:{data:[{id:'r1',username:'prospect',timestamp:'2026-10-09T00:00:00Z'}]} };
      throw Error(path);
    });
    const result:any = await clientFactory().getProfileComments({depth:'all',includeOwn:true});
    expect(result.data).toHaveLength(1);
    expect(get).toHaveBeenCalledWith('/p1/conversation',expect.any(Object));
  });
});
