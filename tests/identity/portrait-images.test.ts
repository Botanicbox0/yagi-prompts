import {it,expect} from 'vitest';
import sharp from 'sharp';
import {cleanPortraitResult} from '@/lib/identity/portrait-images';
import {PORTRAIT_SEEDREAM_MODEL,PORTRAIT_MODEL} from '@/lib/identity/portrait-contract';
it('validates native dimensions by model without resizing faces',async()=>{
 const png=await sharp({create:{width:1664,height:2496,channels:3,background:'#ddd'}}).png().toBuffer();
 const clean=await cleanPortraitResult(png,PORTRAIT_SEEDREAM_MODEL);
 expect(await sharp(clean).metadata()).toMatchObject({width:1664,height:2496});
 await expect(cleanPortraitResult(png,PORTRAIT_MODEL)).rejects.toThrow('invalid_result');
 await expect(cleanPortraitResult(png,'unknown')).rejects.toThrow('invalid_result');
});
