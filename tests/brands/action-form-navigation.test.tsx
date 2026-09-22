import {afterEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({push:vi.fn(),refresh:vi.fn(),assign:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push,refresh:mocks.refresh})}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:()=>{},useState:(value:unknown)=>[value,vi.fn()],useRef:(value:unknown)=>({current:value})}));
import {ManagedForm} from '@/components/brand-workspace/managed-form';
import {ActionForm} from '@/components/brand-workspace/action-form';
import {getDictionary} from '@/lib/i18n/dictionaries';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('workspace creation navigation',()=>{
 it('leaves the stale setup page with one full navigation and no competing router refresh',async()=>{
  const NativeFormData=FormData;
  vi.stubGlobal('FormData',class extends NativeFormData{constructor(){super();this.set('name','Local QA');}});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,id:'org'})}));
  vi.stubGlobal('location',{assign:mocks.assign,origin:'http://localhost:4792'});
  const form=ActionForm({operation:'organization.create',b:getDictionary('en').brandWorkspace,submit:'Create',redirectTo:'/brand/projects/new'});
  await form.props.onSubmit({preventDefault:vi.fn(),currentTarget:{querySelectorAll:()=>[]}});
  expect(mocks.assign).toHaveBeenCalledExactlyOnceWith('/brand/projects/new');
  expect(mocks.refresh).not.toHaveBeenCalled();expect(mocks.push).not.toHaveBeenCalled();
 });
});

it('admin creation navigates once without refreshing stale organization data',async()=>{
 const NativeFormData=FormData;
 vi.stubGlobal('FormData',class extends NativeFormData{constructor(){super();this.set('name','Managed QA');}});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,to:'/admin/brand-workspace'})}));
 vi.stubGlobal('location',{assign:mocks.assign,origin:'http://localhost:4798',hostname:'localhost'});
 const form=ManagedForm({op:'brandWorkspace.organization',b:getDictionary('en').brandWorkspace,submit:'Create',children:null});
 await form.props.onSubmit({preventDefault:vi.fn(),currentTarget:{}});
 expect(mocks.assign).toHaveBeenCalledExactlyOnceWith('/admin/brand-workspace');
 expect(mocks.refresh).not.toHaveBeenCalled();expect(mocks.push).not.toHaveBeenCalled();
});

it('refreshes a saved contract on the same page without hash-only navigation',async()=>{
 const NativeFormData=FormData;vi.stubGlobal('FormData',class extends NativeFormData{});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,to:'/admin/brand-workspace/project'})}));
 vi.stubGlobal('location',{assign:mocks.assign,pathname:'/admin/brand-workspace/project'});
 const form=ManagedForm({op:'brandWorkspace.contract',b:getDictionary('en').brandWorkspace,submit:'Save',children:null});
 await form.props.onSubmit({preventDefault:vi.fn(),currentTarget:undefined});
 expect(mocks.refresh).toHaveBeenCalledOnce();expect(mocks.assign).not.toHaveBeenCalled();expect(mocks.push).not.toHaveBeenCalled();
});
it('reuses the request id after an uncertain admin create response',async()=>{
 const NativeFormData=FormData;vi.stubGlobal('FormData',class extends NativeFormData{constructor(){super();this.set('name','Retry brand');}});
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async(_url,options)=>{calls.push(options.body.get('requestId'));throw Error('network unavailable')}));
 const form=ManagedForm({op:'brandWorkspace.organization',b:getDictionary('en').brandWorkspace,submit:'Create',children:null});
 const e={preventDefault:vi.fn(),currentTarget:undefined};await form.props.onSubmit(e);await form.props.onSubmit(e);
 expect(calls).toHaveLength(2);expect(calls[1]).toBe(calls[0]);
});
