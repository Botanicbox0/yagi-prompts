import {afterEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({push:vi.fn(),refresh:vi.fn(),assign:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push,refresh:mocks.refresh})}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(value:unknown)=>[value,vi.fn()],useRef:(value:unknown)=>({current:value})}));
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
