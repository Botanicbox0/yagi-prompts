import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductionBinding } from '@/components/campaigns/production-binding';
import { getDictionary } from '@/lib/i18n/dictionaries';
const formats = [
  { contractId: 'contract-a', templateId: 'template-a', projectId: 'project-a', title: 'Scene A', titleKo: '장면 A', contractTitle: 'Scope A', projectTitle: 'Project A' },
  { contractId: 'contract-b', templateId: 'template-b', projectId: 'project-b', title: 'Scene B', titleKo: '장면 B', contractTitle: 'Scope B', projectTitle: 'Project B' },
];
const references = [
  { id: 'image-a', name: 'correct-product.png', projectId: 'project-a', projectTitle: 'Project A' },
  { id: 'image-b', name: 'foreign-product.png', projectId: 'project-b', projectTitle: 'Project B' },
];
const config = { contractId: 'contract-a', templateId: 'template-a', referenceAttachmentIds: ['image-a'], enabled: true, revision: 0 };
it('shows only references belonging to the selected campaign project', () => {
  const html = renderToStaticMarkup(<ProductionBinding formats={formats} references={references} config={config} frozen={false} copy={getDictionary('ko').campaigns.production.admin} locale="ko" />);
  expect(html).toContain('correct-product.png'); expect(html).not.toContain('foreign-product.png');
  expect(html).toContain('name="referenceAttachmentIds"');
});
it('keeps the original binding and reference values submit-able while rendering locked controls', () => {
  const html = renderToStaticMarkup(<ProductionBinding formats={formats} references={references} config={config} frozen copy={getDictionary('ko').campaigns.production.admin} locale="ko" />);
  expect(html).toContain('type="hidden" name="binding" value="contract-a|template-a"');
  expect(html).toContain('type="hidden" name="referenceAttachmentIds" value="image-a"');
  expect(html).toContain('<fieldset disabled=""'); expect(html).not.toContain('foreign-product.png');
});
