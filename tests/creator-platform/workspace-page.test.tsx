import { renderToString } from 'react-dom/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({workspace:vi.fn(),access:vi.fn(),maker:vi.fn()}));
vi.mock('@/lib/auth/viewer',()=>({getViewer:async()=>({tier:'free',userId:'f0000000-0000-4000-8000-000000000001',email:null,isAdmin:false,locale:'ko'})}));
vi.mock('@/lib/db/connect',()=>({getSqlRunner:async()=>({})}));
vi.mock('@/lib/i18n/server',()=>({getLocaleFromHeaders:async()=>'ko'}));
vi.mock('@/lib/creator-platform/runtime',()=>({platformAccess:mock.access}));
vi.mock('@/lib/creator-platform/onboarding',()=>({loadCreatorWorkspace:mock.workspace}));
vi.mock('@/components/app/app-header',()=>({AppHeader:()=>null}));
vi.mock('@/lib/makers/profile',async(original)=>({...(await original<typeof import('@/lib/makers/profile')>()),loadMakerSettings:mock.maker}));
import CreatorWorkspacePage from '@/app/(app)/creators/workspace/page';
import { KO_TERMS, ko } from '@/messages/ko';
import type { CreatorWorkspace } from '@/lib/creator-platform/onboarding';

const t=ko.creatorProgram;
const application=(status:'submitted'|'approved'|'declined',createdAt:string):NonNullable<CreatorWorkspace['application']>=>({id:'a',status,displayName:'Rain Maker',portfolioUrl:'https://example.com/me',sampleCount:1,mediums:['video'],decisionNote:status==='declined'?'STUDIO_DECLINE_NOTE':null,createdAt,decidedAt:status==='submitted'?null:createdAt});
const base:CreatorWorkspace={onboarding:true,application:null,creator:{active:false,contractVersion:'pilot-v1',registeredAt:'2026-10-10T00:00:00.000Z'},formats:[{id:'f',title:'OLD_FORMAT',medium:'video',status:'accepted',exampleUrl:'https://instagram.com/reel/x/',createdAt:'2026-10-11T00:00:00.000Z',reviewNote:null,reviewedAt:null,revisionOf:null,template:{state:'published',slug:'old'}}],earnings:[{templateId:'t',title:'OLD_FORMAT',orders:1,settled:1,pending:0,creatorDue:100}]};
const render=async(data:CreatorWorkspace,query:Record<string,string>={})=>{mock.workspace.mockResolvedValue(data);return renderToString(await CreatorWorkspacePage({searchParams:Promise.resolve(query)}));};

beforeEach(()=>{mock.maker.mockResolvedValue({handle:null,bio:null,publicProfile:false});mock.access.mockResolvedValue({ready:true,community:false,creators:true,rewards:false,onboarding:true,applications:true});});
describe('creator workspace states',()=>{
 it('offers a revoked supplier a fresh application while keeping old records read-only',async()=>{
  const html=await render(base);
  expect(html).toContain('data-creator-state="revoked"');
  expect(html).toContain(t.revokedTitle);
  expect(html).toContain('href="/creators/apply"');
  expect(html).toContain('OLD_FORMAT');expect(html).toContain('data-creator-earnings');
  expect(html).not.toContain('data-creator-format-form');
 });
 it('shows a revoked supplier their pending reapplication next to the old records',async()=>{
  const html=await render({...base,application:application('submitted','2026-10-18T00:00:00.000Z')});
  expect(html).toContain('data-creator-application-state="submitted"');
  expect(html).toContain(t.reviewingTitle);
  expect(html).toContain('OLD_FORMAT');
  expect(html).not.toContain('data-creator-format-form');
 });
 it('shows the decision on a reapplication, but not a decline from before the supplier row existed',async()=>{
  const recent=await render({...base,application:application('declined','2026-10-18T00:00:00.000Z')});
  expect(recent).toContain('data-creator-application-state="declined"');
  expect(recent).toContain('STUDIO_DECLINE_NOTE');
  const stale=await render({...base,application:application('declined','2026-10-01T00:00:00.000Z')});
  expect(stale).not.toContain('STUDIO_DECLINE_NOTE');
  expect(stale).toContain('href="/creators/apply"');
 });
 it('hides application calls to action while public intake is closed',async()=>{
  mock.access.mockResolvedValue({ready:true,community:false,creators:true,rewards:false,onboarding:false,applications:false});
  expect(await render(base)).not.toContain('href="/creators/apply"');
 });
 it('labels the supplier row date as registration, not as the latest approval',async()=>{
  const html=await render({...base,creator:{...base.creator!,active:true}});
  expect(html).toContain('data-creator-state="approved"');
  expect(html).toMatch(new RegExp(`${KO_TERMS.makerFull} · [^<]*등록 · 계약 pilot-v1`));
  expect(html).not.toContain('승인 · 계약');
 });
 it('gives an approved maker the public-profile form, off by default (PLATFORM-2.0 §7.5)',async()=>{
  const approved={...base,creator:{...base.creator!,active:true}};
  const html=await render(approved);
  expect(html).toContain('data-maker-profile-settings');
  expect(html).toContain('name="handle"');expect(html).toContain('name="bio"');expect(html).toContain('name="publicProfile"');
  expect(html).not.toMatch(/name="publicProfile"[^>]*checked/);
  expect(html).not.toContain('href="/ko/makers/');
  mock.maker.mockResolvedValue({handle:'jun_01',bio:'소개',publicProfile:true});
  const on=await render(approved,{ok:'profile'});
  expect(on).toContain('href="/ko/makers/jun_01"');expect(on).toContain(t.profile.saved);
  expect(await render(approved,{profile:'handle_taken'})).toContain(t.profile.errors.handle_taken);
  expect(await render(approved,{profile:'<script>'})).not.toContain('data-maker-profile-error');
  mock.maker.mockResolvedValue(null);
  expect(await render(approved)).toContain(t.profile.unavailable);
 });
 it('shows no profile form to a revoked maker',async()=>{
  expect(await render(base)).not.toContain('data-maker-profile-settings');
 });
});
