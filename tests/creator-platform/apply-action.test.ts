import { beforeEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({viewer:vi.fn(),sql:vi.fn(),access:vi.fn(),submit:vi.fn()}));
vi.mock('@/lib/auth/viewer',()=>({getViewer:mock.viewer}));
// next/navigation's redirect throws to abort the action; capture the target instead.
vi.mock('next/navigation',()=>({redirect:(to:string)=>{throw Object.assign(new Error('NEXT_REDIRECT'),{to});}}));
vi.mock('@/lib/db/connect',()=>({getSqlRunner:mock.sql}));
vi.mock('@/lib/creator-platform/runtime',()=>({platformAccess:mock.access}));
vi.mock('@/lib/creator-platform/onboarding',async(original)=>({...(await original<typeof import('@/lib/creator-platform/onboarding')>()),submitCreatorApplication:mock.submit}));
import { submitApplicationAction,submitApplicationForm } from '@/app/(app)/creators/apply/actions';
import { ApplicationFieldError } from '@/lib/creator-platform/onboarding';
import { PlatformError } from '@/lib/creator-platform/contract';

const viewer={tier:'free',userId:'f0000000-0000-4000-8000-000000000001',email:null,isAdmin:false,locale:'ko'};
beforeEach(()=>{vi.clearAllMocks();mock.viewer.mockResolvedValue(viewer);mock.sql.mockResolvedValue({});mock.access.mockResolvedValue({applications:true});});
describe('creator application server action',()=>{
 it('resolves the session itself and never reaches the database anonymously',async()=>{
  mock.viewer.mockResolvedValue({...viewer,userId:null});
  expect(await submitApplicationAction({userId:viewer.userId})).toEqual({ok:false,code:'sign_in_required'});
  expect(mock.sql).not.toHaveBeenCalled();expect(mock.submit).not.toHaveBeenCalled();
 });
 it('passes the session viewer and server-resolved gates, not anything from the payload',async()=>{
  const payload={requestId:'x',access:{applications:true}};
  expect(await submitApplicationAction(payload)).toEqual({ok:true});
  expect(mock.submit).toHaveBeenCalledWith({},viewer,payload,{applications:true});
 });
 it('maps refusals to codes and names only the field',async()=>{
  mock.submit.mockRejectedValueOnce(new ApplicationFieldError('portfolioUrl'));
  expect(await submitApplicationAction({})).toEqual({ok:false,code:'invalid',field:'portfolioUrl'});
  mock.submit.mockRejectedValueOnce(new PlatformError('not_open'));
  expect(await submitApplicationAction({})).toEqual({ok:false,code:'not_open'});
  mock.submit.mockRejectedValueOnce(new Error('connection reset with SECRET detail'));
  expect(JSON.stringify(await submitApplicationAction({}))).not.toContain('SECRET');
 });
 it('accepts a native POST (no JavaScript / before hydration) and redirects without any answer in the URL',async()=>{
  const form=new FormData();
  const answers={requestId:'f0000000-0000-4000-8000-0000000000aa',displayName:'PRIVATE_NAME',portfolioUrl:'https://example.com/PRIVATE_PORTFOLIO',sample1:'https://instagram.com/reel/PRIVATE1/',sample2:'',sample3:'',tools:'PRIVATE_TOOLS',message:'PRIVATE_MESSAGE that is long enough to pass',rights:'on',program:'on'};
  for(const [k,v] of Object.entries(answers))form.set(k,v);form.append('mediums','video');form.append('mediums','image');
  const target=async()=>{try{await submitApplicationForm(form);}catch(error){return (error as {to:string}).to;}throw Error('no redirect');};
  expect(await target()).toBe('/creators/workspace?ok=applied');
  expect(mock.submit).toHaveBeenCalledWith({},viewer,{requestId:answers.requestId,displayName:'PRIVATE_NAME',portfolioUrl:answers.portfolioUrl,samples:[answers.sample1,'',''],mediums:['video','image'],tools:'PRIVATE_TOOLS',message:answers.message,rights:true,program:true},{applications:true});
  mock.submit.mockRejectedValueOnce(new ApplicationFieldError('message'));
  const refused=await target();
  expect(refused).toBe('/creators/apply?err=invalid&field=message');
  mock.submit.mockRejectedValueOnce(new PlatformError('rate_limited'));
  expect(await target()).toBe('/creators/apply?err=rate_limited');
  mock.viewer.mockResolvedValue({...viewer,userId:null});
  expect(await target()).toBe('/creators/apply?err=sign_in_required');
  for(const url of [refused])expect(url).not.toMatch(/PRIVATE/);
 });
});
