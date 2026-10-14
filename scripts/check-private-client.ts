import { readFile,readdir } from 'node:fs/promises';
import { resolve,dirname,relative,extname } from 'node:path';
import ts from 'typescript';

const root=process.cwd();
const privateModules=new Set(['lib/identity/portrait-contract.ts','lib/identity/portrait-provider.ts','lib/renders/prompt.ts','lib/premium-editing/provider.ts','lib/creator-platform/admin.ts','lib/creator-platform/rewards.ts','lib/creator-platform/service.ts']);
async function files(dir:string):Promise<string[]> {
 try {const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?files(resolve(dir,e.name)):Promise.resolve([resolve(dir,e.name)])))).flat();}catch{return [];}
}
const sources=(await Promise.all(['app','components','lib'].map(d=>files(resolve(root,d))))).flat().filter(f=>/\.[cm]?[jt]sx?$/.test(f));
const known=new Set(sources),cache=new Map<string,ts.SourceFile>();
async function source(path:string){let s=cache.get(path);if(!s){s=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);cache.set(path,s);}return s;}
function directive(s:ts.SourceFile,value:string){return s.statements.some(n=>ts.isExpressionStatement(n)&&ts.isStringLiteral(n.expression)&&n.expression.text===value);}
function imports(s:ts.SourceFile):string[] {
 const out:string[]=[];
 function visit(n:ts.Node){
  if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)) {
   const c=n.importClause;if(c?.isTypeOnly)return;
   if(c&&!c.name&&c.namedBindings&&ts.isNamedImports(c.namedBindings)&&c.namedBindings.elements.every(e=>e.isTypeOnly))return;
   out.push(n.moduleSpecifier.text);
  } else if(ts.isExportDeclaration(n)&&!n.isTypeOnly&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))out.push(n.moduleSpecifier.text);
  else if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0]))out.push(n.arguments[0].text);
  ts.forEachChild(n,visit);
 }visit(s);return out;
}
const problems:string[]=[];let clients=0;
for(const file of sources) {
 const s=await source(file);if(!directive(s,'use client'))continue;clients++;
 const seen=new Set<string>();
 async function walk(path:string,chain:string[]) {
  if(seen.has(path))return;seen.add(path);
  const parsed=await source(path);if(directive(parsed,'use server'))return;
  const rel=relative(root,path).replaceAll('\\','/'),deps=imports(parsed);
  if(privateModules.has(rel)||deps.includes('server-only')){problems.push([...chain,rel].join(' -> '));return;}
  for(const dep of deps) {
   const stem=dep.startsWith('@/')?resolve(root,dep.slice(2)):dep.startsWith('.')?resolve(dirname(path),dep):null;
   if(!stem)continue;
   const target=[stem,`${stem}.ts`,`${stem}.tsx`,resolve(stem,'index.ts'),resolve(stem,'index.tsx')].find(p=>known.has(p));
   if(target)await walk(target,[...chain,rel]);
  }
 }await walk(file,[]);
}
if(process.argv.includes('--built')) {
 const built=await files(resolve(root,'.next/static'));
 if(!built.length)throw Error('Build missing: run build:local before --built');
 const secrets:string[]=[];
 const contract=await source(resolve(root,'lib/identity/portrait-contract.ts'));
 contract.forEachChild(n=>{if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(ts.isIdentifier(d.name)&&d.name.text.endsWith('PROMPT')&&d.initializer&&(ts.isStringLiteral(d.initializer)||ts.isNoSubstitutionTemplateLiteral(d.initializer)))secrets.push(d.initializer.text.slice(0,100));});
 if(!secrets.length)throw Error('Private prompt canaries missing: update the scanner for the new prompt definition');
 for(const path of built) {
  if(extname(path)==='.map')problems.push(`public source map: ${relative(root,path)}`);
  if(!/\.(js|json|html|txt)$/.test(path))continue;
  const text=await readFile(path,'utf8');if(secrets.some(value=>text.includes(value)||text.includes(JSON.stringify(value).slice(1,-1))))problems.push(`private recipe in ${relative(root,path)}`);
 }
}
if(problems.length){console.error(`Client privacy check FAILED (${problems.length})\n${problems.join('\n')}`);process.exitCode=1;}
else console.log(`Client privacy check PASSED: ${clients} client entry points${process.argv.includes('--built')?', built assets checked':''}`);
