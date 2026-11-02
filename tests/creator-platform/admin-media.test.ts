import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({viewer:vi.fn(),query:vi.fn(),url:vi.fn(),read:vi.fn()}));
vi.mock('@/lib/auth/viewer',()=>({getViewer:mock.viewer}));
vi.mock('@/lib/db/connect',()=>({getSqlRunner:async()=>({query:mock.query})}));
vi.mock('@/lib/renders/store',()=>({getRenderStore:async()=>({url:mock.url,read:mock.read})}));
import { GET } from '@/app/api/admin/community/[id]/media/route';
const context={params:Promise.resolve({id:'f0000000-0000-4000-8000-000000000001'})};
const request=new Request('https://admin.twings.app/api/admin/community/f0000000-0000-4000-8000-000000000001/media');
beforeEach(()=>{vi.clearAllMocks();mock.viewer.mockResolvedValue({isAdmin:true});mock.query.mockResolvedValue({rows:[{result_key:'private/output.png',result_mime:'image/png'}]});});
describe('admin reward evidence media',()=>{
 it('conceals existence from ordinary users before accessing the database',async()=>{
  mock.viewer.mockResolvedValue({isAdmin:false});expect((await GET(request,context)).status).toBe(404);expect(mock.query).not.toHaveBeenCalled();
 });
 it('signs only the matched output for sixty seconds and prevents caching',async()=>{
  mock.url.mockResolvedValue('https://storage.example.test/output?token=test-only');
  const response=await GET(request,context);
  expect(response.status).toBe(302);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(mock.url).toHaveBeenCalledWith('private/output.png',60);expect(mock.read).not.toHaveBeenCalled();
  expect(mock.query.mock.calls[0]![0]).not.toMatch(/input_key|source_key/);
 });
 it('refuses unsafe media types instead of serving active content',async()=>{
  mock.query.mockResolvedValue({rows:[{result_key:'private/output.html',result_mime:'text/html'}]});
  expect((await GET(request,context)).status).toBe(404);expect(mock.url).not.toHaveBeenCalled();
 });
});
