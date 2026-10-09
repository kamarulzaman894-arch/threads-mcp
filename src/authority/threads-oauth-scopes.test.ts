import { describe,it,expect } from 'vitest';
import { threadsOauthScopes } from './threads-oauth-scopes.js';
describe('staging permissions stay read-oriented',()=>{
 it('omits publishing and deletion permissions when approval-gated writes are off',()=>{
   const scopes=threadsOauthScopes(false);
   expect(scopes).toContain('threads_basic');
   expect(scopes).toContain('threads_read_replies');
   expect(scopes).toContain('threads_manage_replies');
   expect(scopes).not.toContain('threads_content_publish');
   expect(scopes).not.toContain('threads_delete');
   expect(new Set(scopes).size).toBe(scopes.length);
 });
 it('retains legacy production grants when owner-gated writes are enabled',()=>{
   const scopes=threadsOauthScopes(true);
   expect(scopes).toContain('threads_content_publish');
   expect(scopes).toContain('threads_delete');
 });
});