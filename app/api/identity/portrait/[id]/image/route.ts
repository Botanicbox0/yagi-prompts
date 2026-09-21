import {getViewer} from '@/lib/auth/viewer';
import {portraitDeps} from '@/lib/identity/portrait-runtime';
import {ownPortrait} from '@/lib/identity/portrait-service';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const viewer=await getViewer();if(!viewer.userId)return new Response(null,{status:401,headers});
  try{
    const deps=await portraitDeps();if(!deps)return new Response(null,{status:503,headers});
    const a=await ownPortrait(deps.sql,viewer.userId,(await params).id);
    const source=new URL(request.url).searchParams.get('kind')==='source';
    const key=a?(source?a.input_key:a.status==='succeeded'?a.result_key:null):null;
    if(!key)return new Response(null,{status:404,headers});
    const bytes=await deps.store.read(key);
    return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'image/png'}});
  }catch{return new Response(null,{status:404,headers});}
}
