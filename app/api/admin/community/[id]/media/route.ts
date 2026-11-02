import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
/** Only a submitted reward's OUTPUT is available to the reviewing studio. Never the input face. */
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
 const viewer=await getViewer();if(!viewer.isAdmin)return new NextResponse(null,{status:404,headers});
 const {id}=await params;if(!z.uuid().safeParse(id).success)return new NextResponse(null,{status:404,headers});
 try {
  const sql=await getSqlRunner();if(!sql)return new NextResponse(null,{status:503,headers});
  const {rows}=await sql.query<{result_key:string;result_mime:string}>(`select j.result_key,j.result_mime from platform_claims c join render_jobs j on j.id=c.render_id where c.id=$1 and j.status='succeeded'`,[id]);
  const row=rows[0];if(!row||!['video/mp4','video/webm','image/png','image/jpeg','image/webp'].includes(row.result_mime))return new NextResponse(null,{status:404,headers});
  const store=await getRenderStore(),signed=await store.url(row.result_key,60);
  if(signed)return new NextResponse(null,{status:302,headers:{...headers,Location:signed}});
  return new NextResponse(new Uint8Array(await store.read(row.result_key)),{headers:{...headers,'Content-Type':row.result_mime}});
 }catch{return new NextResponse(null,{status:503,headers});}
}
