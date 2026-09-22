-- Per-question draft answers; the immutable core result remains in its existing tables.
create table public.assessment_funnel_answers (
  assessment_id uuid primary key references public.assessments(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 8192),
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);
alter table public.assessment_funnel_answers enable row level security;
revoke all on public.assessment_funnel_answers from public, anon, authenticated;
grant select, insert, update on public.assessment_funnel_answers to service_role;

create function public.rpc_funnel_answers(p_session_hash bytea, p_assessment_id uuid, p_expected_revision integer default null, p_patch jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid;
  v_status text;
  v_row public.assessment_funnel_answers%rowtype;
begin
  select session_user_id into v_user from app_private.resolve_session(p_session_hash, p_patch is not null, false);
  select status into v_status from public.assessments where id = p_assessment_id and user_id = v_user for update;
  if not found then perform app_private.raise_api_error('ASSESSMENT_NOT_FOUND'); end if;
  select * into v_row from public.assessment_funnel_answers where assessment_id = p_assessment_id;
  if not found then
    v_row.answers := '{}'::jsonb;
    v_row.revision := 0;
  end if;
  if p_patch is not null then
    if v_status = 'completed' then perform app_private.raise_api_error('ASSESSMENT_LOCKED'); end if;
    if jsonb_typeof(p_patch) <> 'object' or (select count(*) from jsonb_object_keys(p_patch)) <> 1
       or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('motivation','primaryGoal','experience','activityLevel','sitting','focus','barriers','minutes','days','equipment','sexForCalorieEstimation','ageYears','heightCm','weightKg','targetWeightKg'))
    then perform app_private.raise_api_error('VALIDATION_FAILED'); end if;
    -- Same-value retries are harmless even after the first response was lost.
    if p_expected_revision is distinct from v_row.revision and not v_row.answers @> p_patch then
      perform app_private.raise_api_error('REVISION_MISMATCH', jsonb_build_object('currentRevision',v_row.revision)::text);
    end if;
    if not v_row.answers @> p_patch then
      insert into public.assessment_funnel_answers(assessment_id, answers, revision)
      values (p_assessment_id, v_row.answers || p_patch, v_row.revision + 1)
      on conflict (assessment_id) do update set answers = excluded.answers, revision = excluded.revision, updated_at = now()
      returning * into v_row;
    end if;
  end if;
  return jsonb_build_object('revision', v_row.revision, 'answers', v_row.answers);
end;
$$;
revoke all on function public.rpc_funnel_answers(bytea,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.rpc_funnel_answers(bytea,uuid,integer,jsonb) to service_role;

-- Draft writes and finalization both lock the assessment row.
create function app_private.check_funnel_core_consistency()
returns trigger language plpgsql set search_path = '' as $$
declare v_answers jsonb; v_core jsonb;
begin
  if new.status = 'completed' and old.status <> 'completed' then
    select answers into v_answers from public.assessment_funnel_answers where assessment_id = new.id;
    if found then
      select jsonb_build_object('sexForCalorieEstimation',sex_for_calorie_estimation,'primaryGoal',primary_goal,'ageYears',age_years,'heightCm',height_cm,'weightKg',weight_kg,'targetWeightKg',target_weight_kg,'activityLevel',activity_level)
      into v_core from public.assessment_core_inputs where assessment_id = new.id;
      if not v_answers @> v_core then
        perform app_private.raise_api_error('REVISION_MISMATCH', 'Questionnaire answers changed before confirmation.');
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger assessments_check_funnel_core before update on public.assessments
for each row execute function app_private.check_funnel_core_consistency();
