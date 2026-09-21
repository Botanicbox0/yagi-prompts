import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({viewer:vi.fn(),deps:vi.fn(),enqueue:vi.fn(),state:vi.fn(),select:vi.fn(),own:vi.fn(),read:vi.fn(),run:vi.fn(),after:vi.fn()}));
vi.mock('@/lib/auth/viewer',()=>({getViewer:mocks.viewer}));
vi.mock('@/lib/identity/portrait-runtime',()=>({portraitDeps:mocks.deps}));
vi.mock('@/lib/billing/toss-runtime',()=>({isSameOrigin:(r:Request)=>r.headers.get('origin')===new URL(r.url).origin}));
vi.mock('@/lib/identity/portrait-service',()=>({enqueuePortrait:mocks.enqueue,portraitState:mocks.state,selectPortrait:mocks.select,ownPortrait:mocks.own,runPortraitPass:mocks.run}));
vi.mock('next/server',async orig=>({...await orig<typeof import('next/server')>(),after:mocks.after}));
import {GET,POST,PATCH} from '@/app/api/identity/portrait/route';
import {GET as image} from '@/app/api/identity/portrait/[id]/image/route';
const request=(method:string,body?:BodyInit,origin='https://twings.test')=>new Request('https://twings.test/api/identity/portrait',{method,headers:{origin},body});
describe('portrait HTTP ownership and CSRF boundaries',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.viewer.mockResolvedValue({userId:'owner'});mocks.deps.mockResolvedValue({sql:{},store:{read:mocks.read},provider:{}});mocks.state.mockResolvedValue({attempts:[],selected:null,remaining:2});});
 it('refuses anonymous state, creation, selection and image reads before touching storage',async()=>{
  mocks.viewer.mockResolvedValue({userId:null});
  expect((await GET()).status).toBe(401);expect((await POST(request('POST'))).status).toBe(401);expect((await PATCH(request('PATCH'))).status).toBe(401);
  expect((await image(request('GET'),{params:Promise.resolve({id:'id'})})).status).toBe(401);
  expect(mocks.deps).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();
 });
 it('refuses cross-origin mutation and oversized uploads before enqueuing',async()=>{
  expect((await POST(request('POST',undefined,'https://evil.test'))).status).toBe(403);
  expect((await PATCH(request('PATCH','{}','https://evil.test'))).status).toBe(403);
  const r=request('POST');r.headers.set('content-length','4000000');expect((await POST(r)).status).toBe(413);expect(mocks.enqueue).not.toHaveBeenCalled();
 });
 it('returns private state and closes when the feature is unavailable',async()=>{
  const r=await GET();expect(r.headers.get('cache-control')).toContain('no-store');
  mocks.deps.mockResolvedValue(null);expect((await GET()).status).toBe(503);
 });
 it('does not read storage for another owner and never caches an owned image',async()=>{
  mocks.own.mockResolvedValue(null);expect((await image(request('GET'),{params:Promise.resolve({id:'id'})})).status).toBe(404);expect(mocks.read).not.toHaveBeenCalled();
  mocks.own.mockResolvedValue({status:'succeeded',result_key:'private/result.png'});mocks.read.mockResolvedValue(new Uint8Array([1,2]));
  const r=await image(request('GET'),{params:Promise.resolve({id:'id'})});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');expect(mocks.own).toHaveBeenLastCalledWith({},'owner','id');
 });
});
