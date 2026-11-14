-- Credit caps are gone: rendering is never stopped for cost. claim_render_job
-- keeps the approval gate (nothing renders before the owner approves) and the
-- single-use claim (each job is submitted once); it no longer checks a cap.
-- The credit_cap columns stay but are no longer read.
create or replace function claim_render_job(p_job_id uuid) returns jsonb language plpgsql as $$
declare
  j render_jobs;
  v storyboard_versions;
begin
  select * into j from render_jobs where id = p_job_id for update;
  if j.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if j.status <> 'queued' then return jsonb_build_object('ok', false, 'reason', 'not_queued'); end if;

  select * into v from storyboard_versions where id = j.storyboard_version_id;
  if v.approved_at is null or v.approved_by is null or v.state not in ('approved', 'rendering', 'qa') then
    update render_jobs set status = 'blocked', failure_kind = 'gate',
      error = 'storyboard version is not approved', updated_at = now() where id = j.id;
    return jsonb_build_object('ok', false, 'reason', 'not_approved');
  end if;

  update render_jobs set status = 'submitting', updated_at = now() where id = j.id;
  return jsonb_build_object('ok', true);
end $$;

-- Jobs that were paused by a cap carry on.
update render_jobs set status = 'queued', failure_kind = null, error = null, updated_at = now()
  where status = 'blocked' and failure_kind = 'cap';
