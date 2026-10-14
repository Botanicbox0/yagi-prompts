/** Parse only. Never fetch a customer URL or follow its redirects on the application server. */
export function canonicalPost(raw: string): {platform:string;key:string;url:string} | null {
  if (raw.length > 2048 || /[\\\s]|%|\/\.\.?\//.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./,'');
    let id: string | undefined;
    if (host === 'instagram.com') {
      const m = u.pathname.match(/^\/(p|reel|reels)\/([A-Za-z0-9_-]{3,80})\/?$/);
      if (!m) return null;
      return {platform:'instagram',key:`instagram:${m[2]}`,url:`https://www.instagram.com/${m[1]==='p'?'p':'reel'}/${m[2]}/`};
    }
    if (host === 'x.com' || host === 'twitter.com') {
      const m = u.pathname.match(/^\/([A-Za-z0-9_]{1,30})\/status\/(\d{3,30})\/?$/);
      if (!m) return null;
      return {platform:'x',key:`x:${m[2]}`,url:`https://x.com/${m[1]}/status/${m[2]}`};
    }
    if (host === 'tiktok.com') {
      const m = u.pathname.match(/^\/@([A-Za-z0-9_.]{1,40})\/video\/(\d{5,30})\/?$/);
      if (!m) return null;
      return {platform:'tiktok',key:`tiktok:${m[2]}`,url:`https://www.tiktok.com/@${m[1]}/video/${m[2]}`};
    }
    if (host === 'youtu.be') id = u.pathname.slice(1);
    if (host === 'youtube.com') id = u.pathname === '/watch' ? u.searchParams.get('v') ?? undefined : u.pathname.match(/^\/shorts\/([\w-]{11})\/?$/)?.[1];
    if (id && /^[\w-]{11}$/.test(id)) return {platform:'youtube',key:`youtube:${id}`,url:`https://www.youtube.com/watch?v=${id}`};
    return null;
  } catch { return null; }
}
