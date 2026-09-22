import {describe,expect,it} from 'vitest';
import {campaignPerformance,rankCampaignPosts,campaignCsv} from '@/lib/brands/workspace/performance';
import type {BrandPost} from '@/lib/brands/workspace/types';
const post=(id:string,values:Partial<BrandPost>={}):BrandPost=>({id,contentVersionId:id,url:`https://www.instagram.com/p/${id}/`,platform:'instagram',publishedAt:'2026-09-01T00:00:00Z',metricRevision:0,verification:'manual',metricsSource:'studio_review',measuredAt:'2026-09-02T00:00:00Z',views:null,likes:null,comments:null,shares:null,saves:null,createdAt:'2026-09-01T00:00:00Z',...values});
describe('client campaign performance',()=>{
 it('keeps missing figures unknown and measured zeros visible',()=>{
  const empty=campaignPerformance([post('a')]);expect(empty.views.total).toBeNull();expect(empty.engagement.total).toBeNull();
  const measured=campaignPerformance([post('a',{views:0,likes:0,comments:0})]);expect(measured.views.total).toBe(0);expect(measured.engagement.total).toBe(0);expect(measured.engagementRate).toBeNull();
 });
 it('uses only complete likes/comments pairs and matching view denominators for rates',()=>{
  const result=campaignPerformance([post('a',{views:100,likes:10,comments:5}),post('b',{views:900,likes:null,comments:90}),post('c',{views:null,likes:5,comments:5})]);
  expect(result.views).toEqual({total:1000,measured:2});expect(result.engagement).toEqual({total:25,measured:2});expect(result.engagementRate).toBe(15);expect(result.ratePosts).toBe(1);expect(result.comments.total).toBe(100);
 });
 it('ranks view counts and engagement counts separately without mutating snapshots or treating unknown as zero',()=>{
  const posts=[post('a',{views:1000,likes:1,comments:1}),post('b',{views:100,likes:20,comments:5}),post('c',{views:5000,likes:null,comments:100})];
  const before=JSON.stringify(posts);expect(rankCampaignPosts(posts,'views').map(p=>p.id)).toEqual(['c','a','b']);expect(rankCampaignPosts(posts,'engagement').map(p=>p.id)).toEqual(['b','a']);expect(JSON.stringify(posts)).toBe(before);
 });
 it('uses a stable tie break and handles an empty campaign',()=>{
  expect(rankCampaignPosts([post('b',{views:4}),post('a',{views:4})],'views').map(p=>p.id)).toEqual(['a','b']);
  expect(campaignPerformance([])).toMatchObject({totalPosts:0,views:{total:null,measured:0},firstMeasuredAt:null,lastMeasuredAt:null});
 });
 it('exports unknown as blank, zero as zero and escapes spreadsheet formula injection',()=>{
  const csv=campaignCsv([post('a',{views:0,likes:null})],{a:'=HYPERLINK("bad")'},['Post','Title','Platform','URL','Published','Views','Likes','Comments','Shares','Saves','Source','Measured']);
  expect(csv).toContain("'=HYPERLINK");expect(csv).toContain('"0",""');expect(csv).not.toContain('undefined');
 });
});
