import {describe,expect,it} from 'vitest';
import {invitationBrowserAddress} from '@/lib/auth/invitation-transfer';
describe('invitation transfer between browsers',()=>{
  const token='a'.repeat(43),now=10000;
  const pending=JSON.stringify({token,expiresAt:now+30*60*1000});
  it('restores the token only as a fragment on the invitation landing',()=>{
    const url=new URL(invitationBrowserAddress('https://brand.twings.app/brand/invite',pending,now));
    expect(url.hash).toBe(`#token=${token}`);expect(url.search).toBe('');
    expect(invitationBrowserAddress('https://brand.twings.app/auth/choose?next=%2Fbrand%2Finvite',pending,now)).not.toContain(token);
  });
  it('never transfers malformed or expired browser storage',()=>{
    const target='https://brand.twings.app/brand/invite';
    for(const value of ['broken',null,JSON.stringify({token:'bad&next=elsewhere',expiresAt:now+10}),JSON.stringify({token,expiresAt:now-1}),JSON.stringify({token,expiresAt:now+31*60*1000})])expect(invitationBrowserAddress(target,value,now)).toBe(target);
  });
});
