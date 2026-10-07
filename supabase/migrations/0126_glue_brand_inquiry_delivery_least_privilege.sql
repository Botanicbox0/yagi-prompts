-- Follow-up to deployed 0125: Supabase default privileges can already grant ALL to
-- service_role. GRANT SELECT/INSERT/UPDATE adds privileges; it does not remove DELETE.
-- Reset this one table's grants, then restore only the worker's required operations.
-- Do not change database-wide default privileges or any inquiry/customer data.
revoke all on public.brand_inquiry_deliveries from public, anon, authenticated, service_role;
grant select, insert, update on public.brand_inquiry_deliveries to service_role;
