-- 클라우드 적용 필요 — TWINGS · glue migration 0207 — format revision transaction id posture (pairs with 0206)
-- 0206 added the trigger function `platform_stamp_txid()` and replaced `platform_private_format()`. Both get the
-- 0131/0193 posture: no execute for public, anon or authenticated (a trigger function is never a PostgREST /rpc
-- surface) and a fixed search_path. The two new `txid` columns need nothing here: browser roles have no privilege on
-- either table (0131, 0193), and the server role's table-wide grants cover the column, whose value the trigger
-- overwrites on every insert.
revoke all on function platform_stamp_txid() from public,anon,authenticated;
alter function platform_stamp_txid() set search_path=public,pg_temp;
revoke all on function platform_private_format() from public,anon,authenticated;
alter function platform_private_format() set search_path=public,pg_temp;
