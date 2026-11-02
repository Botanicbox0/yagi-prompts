-- An image set makes up to ten pictures since 2026-11-02 (founder). Widens the range only: every
-- row that passed 0-5 passes 0-9, and code that still stops at six keeps working. Apply before the code.
alter table render_job_outputs drop constraint if exists render_job_outputs_position_check;
alter table render_job_outputs add constraint render_job_outputs_position_check check (position between 0 and 9);
