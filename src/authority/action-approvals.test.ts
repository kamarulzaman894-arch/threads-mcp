import { describe, expect, it } from 'vitest';
import { KZActionApprovals } from './action-approvals.js';
import { digestWritePayload } from './write-approval.js';
import { createHash } from 'node:crypto';
describe('KZ manual approval gate', () => {
  const key = 'very-long-kz-owner-key-for-unit-tests';
  function setup(){
    const store = new Map<string,string>();
    let now=1000000;
    const kv={
      get: async(k:string)=>store.get(k)||null,
      set: async(k:string,v:string,_ttl:number)=>{store.set(k,v);return true;},
      getDel: async(k:string)=>{const v=store.get(k)||null;store.delete(k);return v;},
    };
    const gate=new KZActionApprovals(kv,createHash('sha256').update(key).digest('hex'),'https://example.com',()=> 'user-1',()=>now);
    return {gate,advance:(ms:number)=>{now+=ms;}};
  }
  it('requires owner approval and rejects forged/unapproved token',async()=>{
    const {gate}=setup();
    const args={text:'This is a draft'};
    const task=await gate.prepare('threads_create_thread',args);
    expect(task.expiresInSeconds).toBe(1800);
    const req={action:'threads_create_thread',approval:{approved:true as const, approvedBy:'KZ' as const, approvalRef:task.approvalRef},payloadDigest:digestWritePayload('threads_create_thread',args)};
    expect(await gate.validator().validate(req)).toBe(false);
    expect(await gate.ownerApprove(task.approvalRef,'wrong-key')).toBe(false);
    expect(await gate.ownerApprove(task.approvalRef,key)).toBe(true);
    expect(await gate.validator().validate(req)).toBe(true);
    expect(await gate.validator().validate(req)).toBe(false);
  });
  it('never allows changed payload or wrong action and burns ref',async()=>{
    const {gate}=setup();
    const t=await gate.prepare('threads_create_thread',{text:'Original'});
    await gate.ownerApprove(t.approvalRef,key);
    expect(await gate.validator().validate({action:'threads_create_thread',approval:{approved:true,approvedBy:'KZ',approvalRef:t.approvalRef},payloadDigest:digestWritePayload('threads_create_thread',{text:'Altered'})})).toBe(false);
  });
  it('remains approvable after 10 minutes and usable at minute 29',async()=>{
    const {gate,advance}=setup();
    const args={text:'Manual approval TTL coverage'};
    const t=await gate.prepare('threads_create_thread',args);
    expect(t.expiresInSeconds).toBe(1800);
    advance(11 * 60 * 1000);
    expect(await gate.ownerApprove(t.approvalRef,key)).toBe(true);
    advance(18 * 60 * 1000);
    const req={action:'threads_create_thread',approval:{approved:true as const,approvedBy:'KZ' as const,approvalRef:t.approvalRef},payloadDigest:digestWritePayload('threads_create_thread',args)};
    expect(await gate.validator().validate(req)).toBe(true);
    expect(await gate.validator().validate(req)).toBe(false);
  });
  it('rejects expired approval',async()=>{
    const {gate,advance}=setup();
    const t=await gate.prepare('threads_delete_thread',{threadId:'123'});
    advance(1801000);
    expect(await gate.ownerApprove(t.approvalRef,key)).toBe(false);
  });
});
