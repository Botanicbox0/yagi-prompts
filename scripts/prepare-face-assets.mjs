import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('public/models/face-landmarker.json',root),'utf8'));
const model=await readFile(new URL('public/models/face-landmarker-float16-v1.task',root));
if(createHash('sha256').update(model).digest('hex')!==manifest.sha256)throw Error('Face model integrity mismatch');
const vendor=new URL('public/vendor/face-1.1.0/',root);
await mkdir(new URL('wasm/',vendor),{recursive:true});
for(const name of ['vision_bundle.js','wasm/vision_wasm_internal.js','wasm/vision_wasm_internal.wasm','wasm/vision_wasm_nosimd_internal.js','wasm/vision_wasm_nosimd_internal.wasm']){
 const source=new URL(`node_modules/@mediapipe/tasks-vision/${name}`,root);
 if(name.endsWith('.js')){
  // Do not publish vendor source-map references or maps.
  const code=(await readFile(source,'utf8')).replace(/\/\/# sourceMappingURL=.*$/gm,'');
  await writeFile(new URL(name,vendor),code);
 }else await copyFile(source,new URL(name,vendor));
}
console.log('Pinned face assets prepared (local-only inference).');
