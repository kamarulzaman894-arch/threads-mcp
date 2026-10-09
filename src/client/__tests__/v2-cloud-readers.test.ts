import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { ThreadsClient } from '../threads-client.js';

vi.mock('axios');
const mockedAxios=vi.mocked(axios);
const get=vi.fn(),post=vi.fn();
beforeEach(()=>{
  vi.clearAllMocks();
  mockedAxios.create.mockReturnValue({get,post,interceptors:{request:{use:vi.fn()},response:{use:vi.fn()}}} as any);
});
const make=()=>new ThreadsClient({accessToken:'test-only',userId:'owner'});
describe('V2 bounded own comments reader',()=>{
  it('scans owned posts, filters self and resumes cursor without writes',async()=>{
    get.mockImplementation(async(path:string,req:any)=>{
      if(path==='/owner')return{data:{id:'owner',username:'kz'}};
      if(path==='/owner/threads')return{data:{data:[{id:'p1'},{id:'p2'}]}};
      if(path==='/p1/replies')return{data:{data:[{id:'r1',username:'visitor',timestamp:'2026-10-09T00:00:00Z'}]}};
      if(path==='/p2/replies')return{data:{data:[{id:'r2',username:'kz',timestamp:'2026-10-09T00:00:00Z'}]}};
      throw Error(path);
    });
    const c=make(),a:any=await c.getProfileComments({limit:1});
    expect(a.data.map((r:any)=>r.id)).toEqual(['r1']);
    expect(a.meta.next).toBeTruthy();
    const b:any=await c.getProfileComments({limit:1,after:a.meta.next});
    expect(b.data).toHaveLength(0);
    expect(b.meta.next).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
  it('rejects invalid/reused cursors without external requests',async()=>{
    const c=make();
    await expect(c.getProfileComments({after:'bad'})).rejects.toThrow('Invalid comments cursor');
    await expect(c.getProfileComments({since:10,until:9})).rejects.toThrow('since');
    expect(get).not.toHaveBeenCalled();
  });
  it('lists pending replies read-only',async()=>{
    get.mockResolvedValue({data:{data:[{id:'pending'}]}});
    const r:any=await make().getPendingReplies({threadId:'p1',limit:2});
    expect(r.data[0].id).toBe('pending');
    expect(get).toHaveBeenCalledWith('/p1/pending_replies',expect.objectContaining({params:expect.objectContaining({approval_status:'pending',limit:2})}));
    expect(post).not.toHaveBeenCalled();
  });
  it('continues replies when Meta provides cursors but omits paging.next',async()=>{
    get.mockImplementation(async(path:string,config:any)=>{
      if(path==='/owner/threads')return{data:{data:[{id:'p1'}]}};
      if(path==='/p1/replies'&&!config.params.after)return{data:{
        data:[{id:'first',username:'customer',timestamp:'2026-10-09T00:00:00Z'}],
        paging:{cursors:{after:'reply-A'}}
      }};
      if(path==='/p1/replies'&&config.params.after==='reply-A')return{data:{data:[]}};
      throw Error(path);
    });
    const c=make(),a:any=await c.getProfileComments({limit:10,includeOwn:true});
    expect(a.data.map((r:any)=>r.id)).toEqual(['first']);
    expect(a.meta.next).toBeTruthy();
    const b:any=await c.getProfileComments({limit:10,includeOwn:true,after:a.meta.next});
    expect(b.data).toHaveLength(0);
    expect(b.meta.next).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
  it('continues post pages when Meta provides cursor but no paging.next',async()=>{
    get.mockImplementation(async(path:string,config:any)=>{
      if(path==='/owner/threads'&&!config.params.after)return{data:{data:[{id:'p1'}],paging:{cursors:{after:'posts-A'}}}};
      if(path==='/owner/threads'&&config.params.after==='posts-A')return{data:{data:[{id:'p2'}]}};
      if(path==='/p1/replies')return{data:{data:[]}};
      if(path==='/p2/replies')return{data:{data:[{id:'found',username:'customer'}]}};
      throw Error(path);
    });
    const c=make(),a:any=await c.getProfileComments({limit:5,includeOwn:true});
    expect(a.meta.next).toBeTruthy();
    const b:any=await c.getProfileComments({limit:5,includeOwn:true,after:a.meta.next});
    expect(b.data.map((r:any)=>r.id)).toEqual(['found']);
  });

});
