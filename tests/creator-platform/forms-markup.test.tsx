import { renderToString } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
vi.mock('@/app/(app)/creators/apply/actions',()=>({submitApplicationAction:vi.fn(),submitApplicationForm:vi.fn()}));
import { CreatorApplicationForm } from '@/components/creators/application-form';
import { FormatSubmitForm } from '@/components/creators/format-form';
import { ko } from '@/messages/ko';

const formTag=(html:string)=>html.match(/<form[^>]*>/)![0];
const t=ko.creatorProgram,c=ko.community;
const applicationCopy={fieldName:t.fieldName,fieldNameHint:t.fieldNameHint,fieldPortfolio:t.fieldPortfolio,fieldPortfolioHint:t.fieldPortfolioHint,fieldSamples:t.fieldSamples,fieldSamplesHint:t.fieldSamplesHint,fieldMediums:t.fieldMediums,fieldTools:t.fieldTools,fieldMessage:t.fieldMessage,fieldMessageHint:t.fieldMessageHint,rights:t.rights,program:t.program,programLink:t.programLink,submit:t.submit,busy:t.busy,errors:t.errors,fields:t.fields};
const formatCopy={formatName:c.formatName,medium:c.medium,video:c.video,image:c.image,example:c.example,recipe:c.recipe,rights:c.rights,busy:c.busy,submitFormat:c.submitFormat,error:c.error,errors:c.errors,formatNeedsScript:c.formatNeedsScript};

describe('creator forms before hydration',()=>{
 it('never lets the application fall back to a GET carrying answers in the URL',()=>{
  const html=renderToString(<CreatorApplicationForm copy={applicationCopy} media={{image:c.image,video:c.video}} displayName="" programHref="/ko/creators" requestId="f0000000-0000-4000-8000-0000000000aa" initialError={null}/>);
  const tag=formTag(html);
  // A function action always renders an action attribute (Next: the server-action POST; here a throwing guard), never an implicit GET.
  expect(tag).toMatch(/\saction="/);
  expect(tag).not.toMatch(/method="get"/i);
  expect(html).toContain('name="requestId" value="f0000000-0000-4000-8000-0000000000aa"');
 });
 it('renders the no-JS refusal as an alert tied to the invalid group, with no answer echoed',()=>{
  const html=renderToString(<CreatorApplicationForm copy={applicationCopy} media={{image:c.image,video:c.video}} displayName="" programHref="/ko/creators" requestId="f0000000-0000-4000-8000-0000000000aa" initialError={{code:'invalid',field:'mediums'}}/>);
  expect(html).toMatch(/id="creator-apply-error" role="alert" tabindex="-1"/i);
  const group=html.match(/<input[^>]*name="mediums"[^>]*>/g)!;
  expect(group).toHaveLength(2);
  for(const input of group){expect(input).toContain('aria-invalid="true"');expect(input).toContain('aria-describedby="creator-apply-error"');}
  expect(html).toMatch(/<fieldset[^>]*aria-describedby="creator-apply-error"[^>]*><legend>[^<]*주로 만드는 결과물/);
 });
 it('keeps the format form inert until hydration and never targets a GET URL with the recipe',()=>{
  const html=renderToString(<FormatSubmitForm copy={formatCopy}/>);
  const tag=formTag(html);
  expect(tag).toMatch(/method="post"/);
  expect(tag).toMatch(/action="\/api\/community"/);
  expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  expect(html).toContain(c.formatNeedsScript);
 });
});
