-- Health assessment funnel: initial database contract.
--
-- The browser never calls these tables or functions directly. The Next.js server
-- uses a Supabase secret key and calls the public RPCs granted to service_role.
-- Every owner-sensitive RPC resolves a 32-byte session digest in the same
-- transaction; no RPC accepts a client-supplied user id.

begin;

create extension if not exists pgcrypto with schema extensions;

-- Opt out of historic Supabase public-schema auto grants before application
-- objects are created. Repeat object-level revokes at the end for older projects.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

revoke create on schema public from public;

create schema if not exists app_private authorization postgres;
revoke all on schema app_private from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema app_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema app_private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema app_private
  revoke execute on functions from public, anon, authenticated, service_role;

comment on schema app_private is
  'Non-exposed validation, trigger, session and idempotency helpers.';

create function app_private.is_warning_array(p_value jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    p_value is not null
    and jsonb_typeof(p_value) = 'array'
    and jsonb_array_length(p_value) <= 3
    and p_value <@ '[
      "PROFESSIONAL_GUIDANCE_RECOMMENDED",
      "PREDICTION_HORIZON_EXCEEDED",
      "MAINTENANCE_GOAL_NO_ARRIVAL_DATE"
    ]'::jsonb
    and not exists (
      select 1
      from jsonb_array_elements_text(p_value) as warning(code)
      group by warning.code
      having count(*) > 1
    );
$$;

create function app_private.is_valid_projection(p_value jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_item jsonb;
  v_date date;
  v_previous_date date;
  v_weight numeric;
begin
  if p_value is null
     or jsonb_typeof(p_value) <> 'array'
     or jsonb_array_length(p_value) > 105
     or octet_length(p_value::text) > 49152 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ? 'date')
       or not (v_item ? 'weightKg')
       or (v_item - array['date', 'weightKg']) <> '{}'::jsonb
       or jsonb_typeof(v_item -> 'date') <> 'string'
       or jsonb_typeof(v_item -> 'weightKg') <> 'number'
       or (v_item ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$' then
      return false;
    end if;

    begin
      v_date := (v_item ->> 'date')::date;
      v_weight := (v_item ->> 'weightKg')::numeric;
    exception when others then
      return false;
    end;

    if v_weight < 35 or v_weight > 300 then
      return false;
    end if;

    if v_previous_date is not null and v_date <> v_previous_date + 7 then
      return false;
    end if;
    v_previous_date := v_date;
  end loop;

  return true;
end;
$$;

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'standard'
    check (kind in ('standard', 'demo_readonly')),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  last_seen_at timestamptz not null default transaction_timestamp()
);

comment on table public.app_users is
  'Anonymous application principals. demo_readonly principals are immutable through every public write RPC.';

create table public.anonymous_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash bytea not null unique
    check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at)
);

comment on column public.anonymous_sessions.token_hash is
  'SHA-256 digest of the 256-bit base64url bearer credential; plaintext is never persisted.';

create index anonymous_sessions_user_id_idx
  on public.anonymous_sessions(user_id);
create index anonymous_sessions_expires_at_idx
  on public.anonymous_sessions(expires_at);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  quiz_version text not null
    check (quiz_version = 'health-v1'),
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'completed')),
  revision bigint not null default 0
    check (revision >= 0),
  submitted_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique (id, user_id),
  check (
    (status = 'completed' and submitted_at is not null)
    or (status <> 'completed' and submitted_at is null)
  )
);

create unique index assessments_one_active_per_version_idx
  on public.assessments(user_id, quiz_version)
  where status in ('draft', 'ready');
create index assessments_user_id_idx on public.assessments(user_id);
create index assessments_user_updated_at_idx
  on public.assessments(user_id, updated_at desc);

create table public.assessment_core_inputs (
  assessment_id uuid primary key
    references public.assessments(id) on delete cascade,
  sex_for_calorie_estimation text
    check (sex_for_calorie_estimation in ('female', 'male')),
  primary_goal text
    check (primary_goal in ('lose_weight', 'maintain_weight', 'gain_weight')),
  age_years smallint
    check (age_years between 18 and 80),
  height_cm numeric(5,2)
    check (height_cm between 120 and 230),
  weight_kg numeric(6,2)
    check (weight_kg between 35 and 300),
  target_weight_kg numeric(6,2)
    check (target_weight_kg between 35 and 300),
  activity_level text
    check (activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  updated_at timestamptz not null default transaction_timestamp(),
  check (
    weight_kg is null
    or target_weight_kg is null
    or abs(target_weight_kg - weight_kg) <= weight_kg * 0.40
  ),
  check (
    primary_goal is null
    or weight_kg is null
    or target_weight_kg is null
    or (primary_goal = 'lose_weight' and target_weight_kg < weight_kg)
    or (primary_goal = 'gain_weight' and target_weight_kg > weight_kg)
    or (
      primary_goal = 'maintain_weight'
      and abs(target_weight_kg - weight_kg) <= greatest(1::numeric, weight_kg * 0.02)
    )
  ),
  check (
    primary_goal is distinct from 'lose_weight'
    or height_cm is null
    or target_weight_kg is null
    or target_weight_kg / ((height_cm / 100) ^ 2) >= 18.5
  ),
  check (
    primary_goal is distinct from 'gain_weight'
    or height_cm is null
    or target_weight_kg is null
    or target_weight_kg / ((height_cm / 100) ^ 2) <= 40
  )
);

create table public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null unique
    references public.assessments(id) on delete cascade,
  algorithm_version text not null
    check (algorithm_version = 'health-v1'),
  input_revision bigint not null check (input_revision >= 0),
  input_snapshot jsonb not null
    check (jsonb_typeof(input_snapshot) = 'object')
    check (octet_length(input_snapshot::text) <= 4096),
  bmi_raw numeric(12,6) not null check (bmi_raw > 0 and bmi_raw < 300),
  bmi numeric(4,1) not null check (bmi > 0 and bmi < 300),
  bmi_category text not null
    check (bmi_category in ('underweight', 'healthy_weight', 'overweight', 'obesity')),
  calorie_range_min integer,
  calorie_range_max integer,
  calorie_estimate_available boolean not null,
  warnings jsonb not null default '[]'::jsonb
    check (app_private.is_warning_array(warnings)),
  calculated_at timestamptz not null,
  created_at timestamptz not null default transaction_timestamp(),
  check (
    (
      calorie_estimate_available
      and calorie_range_min is not null
      and calorie_range_max is not null
      and calorie_range_min between 1200 and 4500
      and calorie_range_max between 1200 and 4500
      and calorie_range_min <= calorie_range_max
    )
    or (
      not calorie_estimate_available
      and calorie_range_min is null
      and calorie_range_max is null
    )
  )
);

create index assessment_results_assessment_id_idx
  on public.assessment_results(assessment_id);

create table public.assessment_result_details (
  result_id uuid primary key
    references public.assessment_results(id) on delete cascade,
  bmr_raw numeric(14,6) not null check (bmr_raw > 0),
  tdee_raw numeric(14,6) not null check (tdee_raw > 0),
  calorie_target_raw numeric(14,6) not null check (calorie_target_raw > 0),
  bmr_kcal integer not null check (bmr_kcal > 0),
  tdee_kcal integer not null check (tdee_kcal > 0),
  exact_daily_calories integer,
  target_date date,
  weight_projection jsonb not null default '[]'::jsonb
    check (app_private.is_valid_projection(weight_projection)),
  created_at timestamptz not null default transaction_timestamp()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique
    references public.app_users(id) on delete cascade,
  status text not null
    check (status in ('active', 'canceled', 'expired')),
  plan_code text not null
    check (plan_code = 'demo_monthly'),
  valid_from timestamptz not null,
  valid_until timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  check (valid_until is null or valid_until > valid_from)
);

create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_active_lookup_idx
  on public.subscriptions(user_id, valid_from, valid_until)
  where status = 'active';

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete restrict,
  assessment_id uuid not null,
  provider text not null check (provider = 'mock'),
  provider_event_id text not null,
  idempotency_key text not null
    check (idempotency_key ~ '^[A-Za-z0-9._:-]{16,128}$'),
  plan_code text not null check (plan_code = 'demo_monthly'),
  outcome text not null check (outcome in ('activated', 'already_active')),
  processed_at timestamptz not null default transaction_timestamp(),
  constraint payment_events_assessment_owner_fk
    foreign key (assessment_id, user_id)
    references public.assessments(id, user_id)
    on delete restrict,
  unique (provider, provider_event_id),
  unique (provider, user_id, idempotency_key)
);

create index payment_events_user_id_idx on public.payment_events(user_id);
create index payment_events_assessment_owner_idx
  on public.payment_events(assessment_id, user_id);

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  assessment_id uuid,
  scope text not null check (char_length(scope) between 1 and 180),
  key text not null check (key ~ '^[A-Za-z0-9._:-]{16,128}$'),
  request_hash bytea not null check (octet_length(request_hash) = 32),
  resource_type text check (resource_type in ('assessment', 'result', 'payment_event')),
  resource_id uuid,
  response_status smallint not null check (response_status between 200 and 299),
  replay_payload_minimal jsonb not null
    check (jsonb_typeof(replay_payload_minimal) = 'object')
    check (octet_length(replay_payload_minimal::text) <= 8192),
  created_at timestamptz not null default transaction_timestamp(),
  expires_at timestamptz not null,
  constraint idempotency_records_assessment_owner_fk
    foreign key (assessment_id, user_id)
    references public.assessments(id, user_id)
    on delete cascade,
  unique (user_id, scope, key),
  check ((resource_type is null) = (resource_id is null)),
  check (expires_at > created_at and expires_at <= created_at + interval '25 hours')
);

create index idempotency_records_user_id_idx on public.idempotency_records(user_id);
create index idempotency_records_assessment_owner_idx
  on public.idempotency_records(assessment_id, user_id);
create index idempotency_records_expires_at_idx
  on public.idempotency_records(expires_at);

comment on table public.assessment_results is
  'Preview-safe result fields only. Protected exact values and the curve live in assessment_result_details.';
comment on table public.assessment_result_details is
  'Paid-only result fields. Result RPC reads this table only after live entitlement succeeds.';
comment on table public.payment_events is
  'Append-only mock-payment attempt audit. Current entitlement lives in subscriptions.';
comment on table public.idempotency_records is
  '24-hour request replay metadata; never stores plaintext session credentials or complete health results.';

create function app_private.raise_api_error(p_code text, p_detail text default '')
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code,
    detail = coalesce(p_detail, '');
end;
$$;

create function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := transaction_timestamp();
  return new;
end;
$$;

create function app_private.enforce_app_user_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.kind is distinct from old.kind
     or new.created_at is distinct from old.created_at then
    perform app_private.raise_api_error(
      'IMMUTABLE_USER_IDENTITY',
      'Application user identity, kind and creation time are immutable.'
    );
  end if;
  return new;
end;
$$;

create trigger app_users_enforce_identity
before update on public.app_users
for each row execute function app_private.enforce_app_user_identity();

create trigger app_users_touch_updated_at
before update on public.app_users
for each row execute function app_private.touch_updated_at();

create function app_private.enforce_anonymous_session_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.token_hash is distinct from old.token_hash
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    perform app_private.raise_api_error(
      'IMMUTABLE_SESSION_IDENTITY',
      'Session identity, owner, credential, expiry and creation time are immutable.'
    );
  end if;

  if old.revoked_at is not null
     and new.revoked_at is distinct from old.revoked_at then
    perform app_private.raise_api_error(
      'SESSION_ALREADY_REVOKED',
      'A revoked session cannot be restored or re-revoked.'
    );
  end if;

  return new;
end;
$$;

create trigger anonymous_sessions_enforce_update
before update on public.anonymous_sessions
for each row execute function app_private.enforce_anonymous_session_update();

create trigger assessment_core_inputs_touch_updated_at
before update on public.assessment_core_inputs
for each row execute function app_private.touch_updated_at();

create function app_private.enforce_assessment_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.quiz_version is distinct from old.quiz_version
     or new.created_at is distinct from old.created_at then
    perform app_private.raise_api_error(
      'IMMUTABLE_ASSESSMENT_IDENTITY',
      'Assessment identity, owner, version and creation time are immutable.'
    );
  end if;

  if old.status = 'completed' then
    perform app_private.raise_api_error('ASSESSMENT_LOCKED', 'Completed assessments are immutable.');
  end if;

  if new.revision <> old.revision + 1 then
    perform app_private.raise_api_error(
      'INVALID_REVISION_TRANSITION',
      'Every successful assessment mutation must increment revision exactly once.'
    );
  end if;

  if not (
    (old.status = 'draft' and new.status in ('draft', 'ready'))
    or (old.status = 'ready' and new.status in ('ready', 'completed'))
  ) then
    perform app_private.raise_api_error(
      'INVALID_ASSESSMENT_TRANSITION',
      old.status || ' -> ' || new.status
    );
  end if;

  new.updated_at := transaction_timestamp();
  return new;
end;
$$;

create trigger assessments_enforce_lifecycle
before update on public.assessments
for each row execute function app_private.enforce_assessment_lifecycle();

create function app_private.enforce_subscription_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    perform app_private.raise_api_error(
      'IMMUTABLE_SUBSCRIPTION_IDENTITY',
      'Subscription identity, owner and creation time are immutable.'
    );
  end if;

  if new.revision <> old.revision + 1 then
    perform app_private.raise_api_error(
      'INVALID_SUBSCRIPTION_REVISION',
      'Subscription updates increment revision exactly once.'
    );
  end if;
  new.updated_at := transaction_timestamp();
  return new;
end;
$$;

create trigger subscriptions_enforce_revision
before update on public.subscriptions
for each row execute function app_private.enforce_subscription_revision();

create function app_private.guard_core_input_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_assessment_id uuid := coalesce(new.assessment_id, old.assessment_id);
  v_status text;
begin
  if tg_op = 'UPDATE'
     and new.assessment_id is distinct from old.assessment_id then
    perform app_private.raise_api_error(
      'IMMUTABLE_INPUT_IDENTITY',
      'An input row cannot move between assessments.'
    );
  end if;

  -- Permit an FK cascade initiated by deleting the owning assessment. Direct
  -- writes against completed input remain forbidden.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  select a.status into v_status
  from public.assessments as a
  where a.id = v_assessment_id;

  if v_status = 'completed' then
    perform app_private.raise_api_error('ASSESSMENT_LOCKED', 'Completed inputs are immutable.');
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger assessment_core_inputs_guard_mutation
before update or delete on public.assessment_core_inputs
for each row execute function app_private.guard_core_input_mutation();

create function app_private.prevent_result_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  perform app_private.raise_api_error('IMMUTABLE_RESULT', 'Persisted assessment results are append-only.');
  return null;
end;
$$;

create trigger assessment_results_immutable
before update or delete on public.assessment_results
for each row execute function app_private.prevent_result_mutation();

create trigger assessment_result_details_immutable
before update or delete on public.assessment_result_details
for each row execute function app_private.prevent_result_mutation();

create function app_private.prevent_payment_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app_private.raise_api_error('IMMUTABLE_PAYMENT_EVENT', 'Payment events are append-only.');
  return null;
end;
$$;

create trigger payment_events_immutable
before update on public.payment_events
for each row execute function app_private.prevent_payment_event_mutation();

create function app_private.prevent_idempotency_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app_private.raise_api_error(
    'IMMUTABLE_IDEMPOTENCY_RECORD',
    'Idempotency records may expire and be deleted, but never updated.'
  );
  return null;
end;
$$;

create trigger idempotency_records_no_update
before update on public.idempotency_records
for each row execute function app_private.prevent_idempotency_update();

create function app_private.inputs_are_complete(p_assessment_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select
      i.sex_for_calorie_estimation is not null
      and i.primary_goal is not null
      and i.age_years is not null
      and i.height_cm is not null
      and i.weight_kg is not null
      and i.target_weight_kg is not null
      and i.activity_level is not null
    from public.assessment_core_inputs as i
    where i.assessment_id = p_assessment_id
  ), false);
$$;

create function app_private.enforce_assessment_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_status text;
  v_complete boolean;
  v_has_inputs boolean;
  v_has_result boolean;
  v_has_details boolean;
begin
  if tg_table_name = 'assessments' then
    v_assessment_id := coalesce(new.id, old.id);
  else
    v_assessment_id := coalesce(new.assessment_id, old.assessment_id);
  end if;

  select a.status into v_status
  from public.assessments as a
  where a.id = v_assessment_id;

  -- The parent was deleted and its child trigger is observing an FK cascade.
  if not found then
    return null;
  end if;

  select exists (
    select 1 from public.assessment_core_inputs as i
    where i.assessment_id = v_assessment_id
  ) into v_has_inputs;

  v_complete := app_private.inputs_are_complete(v_assessment_id);

  select exists (
    select 1 from public.assessment_results as r
    where r.assessment_id = v_assessment_id
  ) into v_has_result;

  select exists (
    select 1
    from public.assessment_results as r
    join public.assessment_result_details as d on d.result_id = r.id
    where r.assessment_id = v_assessment_id
  ) into v_has_details;

  if not v_has_inputs then
    perform app_private.raise_api_error('ASSESSMENT_INPUT_ROW_REQUIRED', 'Every assessment owns one input row.');
  end if;

  if v_status = 'draft' and v_complete then
    perform app_private.raise_api_error('INVALID_DRAFT_STATE', 'A complete assessment must be ready.');
  end if;

  if v_status in ('ready', 'completed') and not v_complete then
    perform app_private.raise_api_error('ASSESSMENT_INCOMPLETE', 'Ready and completed assessments require every input.');
  end if;

  if v_status = 'completed' and (not v_has_result or not v_has_details) then
    perform app_private.raise_api_error('RESULT_REQUIRED', 'Completion requires both result partitions.');
  end if;

  if v_status <> 'completed' and (v_has_result or v_has_details) then
    perform app_private.raise_api_error('RESULT_BEFORE_COMPLETION', 'Draft and ready assessments cannot retain results.');
  end if;

  return null;
end;
$$;

create constraint trigger assessments_consistency_check
after insert or update on public.assessments
deferrable initially deferred
for each row execute function app_private.enforce_assessment_consistency();

create constraint trigger assessment_core_inputs_consistency_check
after insert or update or delete on public.assessment_core_inputs
deferrable initially deferred
for each row execute function app_private.enforce_assessment_consistency();

-- Keep the parent lifecycle invariant intact even if a privileged server
-- caller bypasses the public RPC layer and writes the result table directly.
-- The trigger is deferred so the normal finalize transaction can insert both
-- result partitions before moving the assessment to `completed`.
create constraint trigger assessment_results_assessment_consistency_check
after insert or update or delete on public.assessment_results
deferrable initially deferred
for each row execute function app_private.enforce_assessment_consistency();

create function app_private.enforce_result_partition_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_result_id uuid;
  v_available boolean;
  v_exact integer;
  v_target_date date;
  v_projection jsonb;
begin
  if tg_table_name = 'assessment_results' then
    v_result_id := coalesce(new.id, old.id);
  else
    v_result_id := coalesce(new.result_id, old.result_id);
  end if;

  select
    r.calorie_estimate_available,
    d.exact_daily_calories,
    d.target_date,
    d.weight_projection
  into v_available, v_exact, v_target_date, v_projection
  from public.assessment_results as r
  join public.assessment_result_details as d on d.result_id = r.id
  where r.id = v_result_id;

  if not found then
    -- Intermediate state is allowed inside submit; assessment consistency
    -- separately requires both partitions at transaction commit.
    return null;
  end if;

  if v_available and v_exact is null then
    perform app_private.raise_api_error('INVALID_RESULT_DETAILS', 'Available calorie estimates require an exact value.');
  end if;

  if not v_available and (
    v_exact is not null
    or v_target_date is not null
    or jsonb_array_length(v_projection) <> 0
  ) then
    perform app_private.raise_api_error(
      'INVALID_RESULT_DETAILS',
      'Unavailable calorie estimates cannot expose exact values, dates or projections.'
    );
  end if;

  return null;
end;
$$;

create constraint trigger assessment_results_partition_check
after insert or update on public.assessment_results
deferrable initially deferred
for each row execute function app_private.enforce_result_partition_consistency();

create constraint trigger assessment_result_details_partition_check
after insert or update on public.assessment_result_details
deferrable initially deferred
for each row execute function app_private.enforce_result_partition_consistency();

create function app_private.resolve_session(
  p_session_hash bytea,
  p_require_writable boolean,
  p_touch boolean
)
returns table (
  session_record_id uuid,
  session_user_id uuid,
  session_user_kind text,
  session_expires_at timestamptz
)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_revoked_at timestamptz;
begin
  if p_session_hash is null or octet_length(p_session_hash) <> 32 then
    perform app_private.raise_api_error('SESSION_REQUIRED', 'A valid session digest is required.');
  end if;

  select s.id, s.user_id, u.kind, s.expires_at, s.revoked_at
  into session_record_id, session_user_id, session_user_kind, session_expires_at, v_revoked_at
  from public.anonymous_sessions as s
  join public.app_users as u on u.id = s.user_id
  where s.token_hash = p_session_hash;

  if not found then
    perform app_private.raise_api_error('SESSION_REQUIRED', 'The session is unknown.');
  end if;

  if v_revoked_at is not null or session_expires_at <= transaction_timestamp() then
    perform app_private.raise_api_error('SESSION_EXPIRED', 'The session expired or was revoked.');
  end if;

  if p_require_writable and session_user_kind = 'demo_readonly' then
    perform app_private.raise_api_error(
      'DEMO_SESSION_READ_ONLY',
      'The public paid fixture is read-only.'
    );
  end if;

  if p_touch then
    update public.app_users
    set last_seen_at = transaction_timestamp()
    where id = session_user_id
      and last_seen_at < transaction_timestamp() - interval '15 minutes';
  end if;

  return next;
end;
$$;

create function app_private.get_idempotency_replay(
  p_user_id uuid,
  p_scope text,
  p_key text,
  p_request_hash bytea
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_record public.idempotency_records%rowtype;
begin
  if p_scope is null or char_length(p_scope) not between 1 and 180 then
    perform app_private.raise_api_error('INVALID_IDEMPOTENCY_SCOPE', 'Invalid internal idempotency scope.');
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9._:-]{16,128}$' then
    perform app_private.raise_api_error('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must match the documented format.');
  end if;
  if p_request_hash is null or octet_length(p_request_hash) <> 32 then
    perform app_private.raise_api_error('INVALID_REQUEST_HASH', 'Canonical request hash must be SHA-256.');
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_scope || ':' || p_key, 0)
  );

  delete from public.idempotency_records
  where user_id = p_user_id
    and scope = p_scope
    and key = p_key
    and expires_at <= transaction_timestamp();

  select * into v_record
  from public.idempotency_records
  where user_id = p_user_id
    and scope = p_scope
    and key = p_key
  for update;

  if not found then
    return null;
  end if;

  if v_record.request_hash <> p_request_hash then
    perform app_private.raise_api_error(
      'IDEMPOTENCY_KEY_REUSED',
      'This key was already used with a different canonical request.'
    );
  end if;

  return jsonb_build_object(
    'replayed', true,
    'responseStatus', v_record.response_status,
    'payload', v_record.replay_payload_minimal
  );
end;
$$;

create function app_private.record_idempotency(
  p_user_id uuid,
  p_assessment_id uuid,
  p_scope text,
  p_key text,
  p_request_hash bytea,
  p_resource_type text,
  p_resource_id uuid,
  p_response_status smallint,
  p_payload jsonb
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  insert into public.idempotency_records (
    user_id,
    assessment_id,
    scope,
    key,
    request_hash,
    resource_type,
    resource_id,
    response_status,
    replay_payload_minimal,
    expires_at
  ) values (
    p_user_id,
    p_assessment_id,
    p_scope,
    p_key,
    p_request_hash,
    p_resource_type,
    p_resource_id,
    p_response_status,
    p_payload,
    transaction_timestamp() + interval '24 hours'
  );
end;
$$;

create function app_private.step_is_complete(
  p_inputs public.assessment_core_inputs,
  p_step_key text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_step_key
    when 'sex' then p_inputs.sex_for_calorie_estimation is not null
    when 'goal' then p_inputs.primary_goal is not null
    when 'body' then
      p_inputs.age_years is not null
      and p_inputs.height_cm is not null
      and p_inputs.weight_kg is not null
      and p_inputs.target_weight_kg is not null
    when 'activity' then p_inputs.activity_level is not null
    else false
  end;
$$;

create function app_private.completed_steps(p_inputs public.assessment_core_inputs)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_remove(array[
    case when app_private.step_is_complete(p_inputs, 'sex') then 'sex'::text end,
    case when app_private.step_is_complete(p_inputs, 'goal') then 'goal'::text end,
    case when app_private.step_is_complete(p_inputs, 'body') then 'body'::text end,
    case when app_private.step_is_complete(p_inputs, 'activity') then 'activity'::text end
  ], null);
$$;

create function app_private.next_step(p_inputs public.assessment_core_inputs)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not app_private.step_is_complete(p_inputs, 'sex') then 'sex'
    when not app_private.step_is_complete(p_inputs, 'goal') then 'goal'
    when not app_private.step_is_complete(p_inputs, 'body') then 'body'
    when not app_private.step_is_complete(p_inputs, 'activity') then 'activity'
    else 'review'
  end;
$$;

create function app_private.validate_inputs(
  p_sex text,
  p_goal text,
  p_age smallint,
  p_height numeric,
  p_weight numeric,
  p_target_weight numeric,
  p_activity text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_target_bmi numeric;
begin
  if p_sex is not null and p_sex not in ('female', 'male') then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Unsupported calorie-estimation sex value.');
  end if;
  if p_goal is not null and p_goal not in ('lose_weight', 'maintain_weight', 'gain_weight') then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Unsupported primary goal.');
  end if;
  if p_age is not null and p_age not between 18 and 80 then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'ageYears must be an integer from 18 through 80.');
  end if;
  if p_height is not null and p_height not between 120 and 230 then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'heightCm must be from 120 through 230.');
  end if;
  if p_weight is not null and p_weight not between 35 and 300 then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'weightKg must be from 35 through 300.');
  end if;
  if p_target_weight is not null and p_target_weight not between 35 and 300 then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'targetWeightKg must be from 35 through 300.');
  end if;
  if p_activity is not null
     and p_activity not in ('sedentary', 'light', 'moderate', 'active', 'very_active') then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Unsupported activity level.');
  end if;

  if p_weight is not null and p_target_weight is not null then
    if abs(p_target_weight - p_weight) > p_weight * 0.40 then
      perform app_private.raise_api_error('UNREASONABLE_TARGET', 'Target delta exceeds 40 percent.');
    end if;

    if p_goal = 'lose_weight' and p_target_weight >= p_weight then
      perform app_private.raise_api_error('UNREASONABLE_TARGET', 'A loss target must be below current weight.');
    elsif p_goal = 'gain_weight' and p_target_weight <= p_weight then
      perform app_private.raise_api_error('UNREASONABLE_TARGET', 'A gain target must be above current weight.');
    elsif p_goal = 'maintain_weight'
      and abs(p_target_weight - p_weight) > greatest(1::numeric, p_weight * 0.02) then
      perform app_private.raise_api_error('UNREASONABLE_TARGET', 'A maintenance target is outside tolerance.');
    end if;
  end if;

  if p_height is not null and p_target_weight is not null and p_goal is not null then
    v_target_bmi := p_target_weight / ((p_height / 100) ^ 2);
    if p_goal = 'lose_weight' and v_target_bmi < 18.5 then
      perform app_private.raise_api_error('UNREASONABLE_TARGET', 'Loss target BMI would be below 18.5.');
    elsif p_goal = 'gain_weight' and v_target_bmi > 40 then
      perform app_private.raise_api_error('UNREASONABLE_TARGET', 'Gain target BMI would exceed 40.');
    end if;
  end if;
end;
$$;

create function app_private.assessment_payload(p_assessment_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_assessment public.assessments%rowtype;
  v_inputs public.assessment_core_inputs%rowtype;
  v_answers jsonb := '{}'::jsonb;
begin
  select * into v_assessment
  from public.assessments
  where id = p_assessment_id;

  if not found then
    return null;
  end if;

  select * into v_inputs
  from public.assessment_core_inputs
  where assessment_id = p_assessment_id;

  if app_private.step_is_complete(v_inputs, 'sex') then
    v_answers := v_answers || jsonb_build_object(
      'sex', jsonb_build_object('sexForCalorieEstimation', v_inputs.sex_for_calorie_estimation)
    );
  end if;
  if app_private.step_is_complete(v_inputs, 'goal') then
    v_answers := v_answers || jsonb_build_object(
      'goal', jsonb_build_object('primaryGoal', v_inputs.primary_goal)
    );
  end if;
  if app_private.step_is_complete(v_inputs, 'body') then
    v_answers := v_answers || jsonb_build_object(
      'body', jsonb_build_object(
        'ageYears', v_inputs.age_years,
        'heightCm', v_inputs.height_cm,
        'weightKg', v_inputs.weight_kg,
        'targetWeightKg', v_inputs.target_weight_kg
      )
    );
  end if;
  if app_private.step_is_complete(v_inputs, 'activity') then
    v_answers := v_answers || jsonb_build_object(
      'activity', jsonb_build_object('activityLevel', v_inputs.activity_level)
    );
  end if;

  return jsonb_build_object(
    'assessmentId', v_assessment.id,
    'status', v_assessment.status,
    'quizVersion', v_assessment.quiz_version,
    'revision', v_assessment.revision,
    'completedSteps', to_jsonb(app_private.completed_steps(v_inputs)),
    'nextStep', app_private.next_step(v_inputs),
    'answers', v_answers,
    'updatedAt', v_assessment.updated_at
  );
end;
$$;

create function public.rpc_create_anonymous_session(
  p_session_hash bytea,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_session_id uuid;
begin
  if p_session_hash is null or octet_length(p_session_hash) <> 32 then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Session digest must be 32 bytes.');
  end if;
  if p_expires_at <= transaction_timestamp()
     or p_expires_at > transaction_timestamp() + interval '7 days 5 minutes' then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Standard sessions have a seven-day absolute TTL.');
  end if;

  insert into public.app_users(kind)
  values ('standard')
  returning id into v_user_id;

  insert into public.anonymous_sessions(user_id, token_hash, expires_at)
  values (v_user_id, p_session_hash, p_expires_at)
  returning id into v_session_id;

  return jsonb_build_object(
    'sessionRecordId', v_session_id,
    'expiresAt', p_expires_at,
    'userKind', 'standard'
  );
end;
$$;

create function public.rpc_resolve_session(p_session_hash bytea)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  v_session record;
begin
  select * into v_session
  from app_private.resolve_session(p_session_hash, false, true);

  return jsonb_build_object(
    'sessionRecordId', v_session.session_record_id,
    'expiresAt', v_session.session_expires_at,
    'userKind', v_session.session_user_kind
  );
end;
$$;

create function public.rpc_create_or_get_assessment(
  p_session_hash bytea,
  p_quiz_version text,
  p_idempotency_key text,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  v_session record;
  v_scope text;
  v_replay jsonb;
  v_assessment_id uuid;
  v_payload jsonb;
  v_status smallint;
  v_reused boolean;
begin
  select * into v_session
  from app_private.resolve_session(p_session_hash, true, true);

  if p_quiz_version is distinct from 'health-v1' then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Unsupported quizVersion.');
  end if;

  v_scope := 'assessment:create:' || p_quiz_version;
  v_replay := app_private.get_idempotency_replay(
    v_session.session_user_id,
    v_scope,
    p_idempotency_key,
    p_request_hash
  );
  if v_replay is not null then
    return v_replay;
  end if;

  -- Different keys for the same user/version also serialize, protecting the
  -- partial unique invariant without turning its violation into a 500.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'active-assessment:' || v_session.session_user_id::text || ':' || p_quiz_version,
      0
    )
  );

  select a.id into v_assessment_id
  from public.assessments as a
  where a.user_id = v_session.session_user_id
    and a.quiz_version = p_quiz_version
    and a.status in ('draft', 'ready')
  for update;

  if found then
    v_status := 200;
    v_reused := true;
  else
    insert into public.assessments(user_id, quiz_version)
    values (v_session.session_user_id, p_quiz_version)
    returning id into v_assessment_id;

    insert into public.assessment_core_inputs(assessment_id)
    values (v_assessment_id);

    v_status := 201;
    v_reused := false;
  end if;

  v_payload := (
    app_private.assessment_payload(v_assessment_id)
    - array['quizVersion', 'answers']
  ) || jsonb_build_object('reused', v_reused);

  perform app_private.record_idempotency(
    v_session.session_user_id,
    v_assessment_id,
    v_scope,
    p_idempotency_key,
    p_request_hash,
    'assessment',
    v_assessment_id,
    v_status,
    v_payload
  );

  return jsonb_build_object(
    'replayed', false,
    'responseStatus', v_status,
    'payload', v_payload
  );
end;
$$;

create function public.rpc_get_current_assessment(p_session_hash bytea)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  v_session record;
  v_assessment_id uuid;
begin
  select * into v_session
  from app_private.resolve_session(p_session_hash, false, true);

  select a.id into v_assessment_id
  from public.assessments as a
  where a.user_id = v_session.session_user_id
    and a.status in ('draft', 'ready')
  order by a.updated_at desc, a.id
  limit 1;

  if not found then
    perform app_private.raise_api_error('ASSESSMENT_NOT_FOUND', 'No active assessment exists.');
  end if;

  return app_private.assessment_payload(v_assessment_id);
end;
$$;

create function public.rpc_get_assessment(
  p_session_hash bytea,
  p_assessment_id uuid
)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  v_session record;
begin
  select * into v_session
  from app_private.resolve_session(p_session_hash, false, true);

  if not exists (
    select 1
    from public.assessments as a
    where a.id = p_assessment_id
      and a.user_id = v_session.session_user_id
  ) then
    perform app_private.raise_api_error('ASSESSMENT_NOT_FOUND', 'Assessment was not found.');
  end if;

  return app_private.assessment_payload(p_assessment_id);
end;
$$;

create function public.rpc_fetch_ready_inputs(
  p_session_hash bytea,
  p_assessment_id uuid
)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  v_session record;
  v_assessment public.assessments%rowtype;
  v_inputs public.assessment_core_inputs%rowtype;
begin
  select * into v_session
  from app_private.resolve_session(p_session_hash, true, true);

  select * into v_assessment
  from public.assessments as a
  where a.id = p_assessment_id
    and a.user_id = v_session.session_user_id;

  if not found then
    perform app_private.raise_api_error('ASSESSMENT_NOT_FOUND', 'Assessment was not found.');
  end if;
  if v_assessment.status = 'completed' then
    perform app_private.raise_api_error('ASSESSMENT_LOCKED', 'Assessment is already completed.');
  end if;
  if v_assessment.status <> 'ready' then
    perform app_private.raise_api_error('ASSESSMENT_INCOMPLETE', 'Every required step must be complete.');
  end if;

  select * into v_inputs
  from public.assessment_core_inputs
  where assessment_id = p_assessment_id;

  perform app_private.validate_inputs(
    v_inputs.sex_for_calorie_estimation,
    v_inputs.primary_goal,
    v_inputs.age_years,
    v_inputs.height_cm,
    v_inputs.weight_kg,
    v_inputs.target_weight_kg,
    v_inputs.activity_level
  );

  return jsonb_build_object(
    'assessmentId', v_assessment.id,
    'quizVersion', v_assessment.quiz_version,
    'revision', v_assessment.revision,
    'input', jsonb_build_object(
      'sexForCalorieEstimation', v_inputs.sex_for_calorie_estimation,
      'primaryGoal', v_inputs.primary_goal,
      'ageYears', v_inputs.age_years,
      'heightCm', v_inputs.height_cm,
      'weightKg', v_inputs.weight_kg,
      'targetWeightKg', v_inputs.target_weight_kg,
      'activityLevel', v_inputs.activity_level
    )
  );
end;
$$;

create function public.rpc_save_assessment_step(
  p_session_hash bytea,
  p_assessment_id uuid,
  p_step_key text,
  p_step_payload jsonb,
  p_expected_revision bigint,
  p_idempotency_key text,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  v_session record;
  v_scope text;
  v_replay jsonb;
  v_assessment public.assessments%rowtype;
  v_inputs public.assessment_core_inputs%rowtype;
  v_next_step text;
  v_was_complete boolean;
  v_all_complete boolean;
  v_new_status text;
  v_payload jsonb;
  v_age numeric;
  v_height numeric;
  v_weight numeric;
  v_target_weight numeric;
begin
  select * into v_session
  from app_private.resolve_session(p_session_hash, true, true);

  if p_assessment_id is null then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'assessmentId is required.');
  end if;
  if p_step_key is null or p_step_key not in ('sex', 'goal', 'body', 'activity') then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Unsupported step key.');
  end if;
  if p_step_payload is null or jsonb_typeof(p_step_payload) <> 'object' then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Step payload must be a JSON object.');
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Expected revision must be non-negative.');
  end if;

  v_scope := 'assessment:step:' || p_assessment_id::text || ':' || p_step_key;
  v_replay := app_private.get_idempotency_replay(
    v_session.session_user_id,
    v_scope,
    p_idempotency_key,
    p_request_hash
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_assessment
  from public.assessments as a
  where a.id = p_assessment_id
    and a.user_id = v_session.session_user_id
  for update;

  if not found then
    perform app_private.raise_api_error('ASSESSMENT_NOT_FOUND', 'Assessment was not found.');
  end if;
  if v_assessment.status = 'completed' then
    perform app_private.raise_api_error('ASSESSMENT_LOCKED', 'Completed assessments cannot be edited.');
  end if;
  if v_assessment.revision <> p_expected_revision then
    perform app_private.raise_api_error(
      'REVISION_MISMATCH',
      jsonb_build_object('currentRevision', v_assessment.revision)::text
    );
  end if;

  select * into v_inputs
  from public.assessment_core_inputs as i
  where i.assessment_id = p_assessment_id
  for update;

  v_next_step := app_private.next_step(v_inputs);
  v_was_complete := app_private.step_is_complete(v_inputs, p_step_key);

  if p_step_key <> v_next_step and not v_was_complete then
    perform app_private.raise_api_error(
      'STEP_OUT_OF_ORDER',
      jsonb_build_object('nextStep', v_next_step)::text
    );
  end if;

  case p_step_key
    when 'sex' then
      if not (p_step_payload ? 'sexForCalorieEstimation')
         or (p_step_payload - 'sexForCalorieEstimation') <> '{}'::jsonb
         or jsonb_typeof(p_step_payload -> 'sexForCalorieEstimation') <> 'string' then
        perform app_private.raise_api_error('VALIDATION_FAILED', 'sex payload has an invalid shape.');
      end if;
      v_inputs.sex_for_calorie_estimation := p_step_payload ->> 'sexForCalorieEstimation';

    when 'goal' then
      if not (p_step_payload ? 'primaryGoal')
         or (p_step_payload - 'primaryGoal') <> '{}'::jsonb
         or jsonb_typeof(p_step_payload -> 'primaryGoal') <> 'string' then
        perform app_private.raise_api_error('VALIDATION_FAILED', 'goal payload has an invalid shape.');
      end if;
      v_inputs.primary_goal := p_step_payload ->> 'primaryGoal';

    when 'activity' then
      if not (p_step_payload ? 'activityLevel')
         or (p_step_payload - 'activityLevel') <> '{}'::jsonb
         or jsonb_typeof(p_step_payload -> 'activityLevel') <> 'string' then
        perform app_private.raise_api_error('VALIDATION_FAILED', 'activity payload has an invalid shape.');
      end if;
      v_inputs.activity_level := p_step_payload ->> 'activityLevel';

    when 'body' then
      if not (p_step_payload ?& array['ageYears', 'heightCm', 'weightKg', 'targetWeightKg'])
         or (p_step_payload - array['ageYears', 'heightCm', 'weightKg', 'targetWeightKg']) <> '{}'::jsonb
         or jsonb_typeof(p_step_payload -> 'ageYears') <> 'number'
         or jsonb_typeof(p_step_payload -> 'heightCm') <> 'number'
         or jsonb_typeof(p_step_payload -> 'weightKg') <> 'number'
         or jsonb_typeof(p_step_payload -> 'targetWeightKg') <> 'number' then
        perform app_private.raise_api_error('VALIDATION_FAILED', 'body payload has an invalid shape.');
      end if;

      v_age := (p_step_payload ->> 'ageYears')::numeric;
      v_height := (p_step_payload ->> 'heightCm')::numeric;
      v_weight := (p_step_payload ->> 'weightKg')::numeric;
      v_target_weight := (p_step_payload ->> 'targetWeightKg')::numeric;

      if v_age <> trunc(v_age) or v_age not between 18 and 80 then
        perform app_private.raise_api_error('VALIDATION_FAILED', 'ageYears must be an integer from 18 through 80.');
      end if;
      if v_height not between 120 and 230 or v_height <> round(v_height, 2) then
        perform app_private.raise_api_error('VALIDATION_FAILED', 'heightCm must be 120..230 with at most two decimals.');
      end if;
      if v_weight not between 35 and 300 or v_weight <> round(v_weight, 2) then
        perform app_private.raise_api_error('VALIDATION_FAILED', 'weightKg must be 35..300 with at most two decimals.');
      end if;
      if v_target_weight not between 35 and 300 or v_target_weight <> round(v_target_weight, 2) then
        perform app_private.raise_api_error(
          'VALIDATION_FAILED',
          'targetWeightKg must be 35..300 with at most two decimals.'
        );
      end if;

      v_inputs.age_years := v_age::smallint;
      v_inputs.height_cm := v_height;
      v_inputs.weight_kg := v_weight;
      v_inputs.target_weight_kg := v_target_weight;
  end case;

  perform app_private.validate_inputs(
    v_inputs.sex_for_calorie_estimation,
    v_inputs.primary_goal,
    v_inputs.age_years,
    v_inputs.height_cm,
    v_inputs.weight_kg,
    v_inputs.target_weight_kg,
    v_inputs.activity_level
  );

  update public.assessment_core_inputs
  set
    sex_for_calorie_estimation = v_inputs.sex_for_calorie_estimation,
    primary_goal = v_inputs.primary_goal,
    age_years = v_inputs.age_years,
    height_cm = v_inputs.height_cm,
    weight_kg = v_inputs.weight_kg,
    target_weight_kg = v_inputs.target_weight_kg,
    activity_level = v_inputs.activity_level
  where assessment_id = p_assessment_id;

  v_all_complete :=
    v_inputs.sex_for_calorie_estimation is not null
    and v_inputs.primary_goal is not null
    and v_inputs.age_years is not null
    and v_inputs.height_cm is not null
    and v_inputs.weight_kg is not null
    and v_inputs.target_weight_kg is not null
    and v_inputs.activity_level is not null;
  v_new_status := case when v_all_complete then 'ready' else 'draft' end;

  update public.assessments
  set status = v_new_status,
      revision = revision + 1
  where id = p_assessment_id;

  -- The public save response never contains cumulative answers. Keeping the
  -- replay payload to the same allowlist prevents duplicate health data from
  -- accumulating in the idempotency table.
  v_payload := app_private.assessment_payload(p_assessment_id)
    - array['quizVersion', 'answers'];

  perform app_private.record_idempotency(
    v_session.session_user_id,
    p_assessment_id,
    v_scope,
    p_idempotency_key,
    p_request_hash,
    'assessment',
    p_assessment_id,
    200::smallint,
    v_payload
  );

  return jsonb_build_object(
    'replayed', false,
    'responseStatus', 200,
    'payload', v_payload
  );
end;
$$;

create function public.rpc_finalize_assessment(
  p_session_hash bytea,
  p_assessment_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text,
  p_request_hash bytea,
  p_result jsonb
)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  v_session record;
  v_scope text;
  v_replay jsonb;
  v_assessment public.assessments%rowtype;
  v_inputs public.assessment_core_inputs%rowtype;
  v_result_id uuid;
  v_payload jsonb;
  v_bmi_raw numeric;
  v_bmi numeric;
  v_bmi_category text;
  v_base_raw numeric;
  v_bmr_raw numeric;
  v_bmr integer;
  v_activity_factor numeric;
  v_tdee_raw numeric;
  v_tdee integer;
  v_calorie_raw numeric;
  v_floor integer;
  v_available boolean;
  v_exact integer;
  v_range_center integer;
  v_range_min integer;
  v_range_max integer;
  v_target_date date;
  v_calculated_at timestamptz;
  v_calculated_date date;
  v_projection jsonb;
  v_warnings jsonb;
  v_weekly_rate numeric;
  v_weeks integer;
  v_index integer;
  v_item jsonb;
  v_expected_date date;
  v_expected_weight numeric;
  v_snapshot jsonb;
begin
  select * into v_session
  from app_private.resolve_session(p_session_hash, true, true);

  if p_assessment_id is null then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'assessmentId is required.');
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Expected revision must be non-negative.');
  end if;

  v_scope := 'assessment:submit:' || p_assessment_id::text;
  v_replay := app_private.get_idempotency_replay(
    v_session.session_user_id,
    v_scope,
    p_idempotency_key,
    p_request_hash
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_assessment
  from public.assessments as a
  where a.id = p_assessment_id
    and a.user_id = v_session.session_user_id
  for update;

  if not found then
    perform app_private.raise_api_error('ASSESSMENT_NOT_FOUND', 'Assessment was not found.');
  end if;
  if v_assessment.status = 'completed' then
    perform app_private.raise_api_error('ASSESSMENT_LOCKED', 'Assessment is already completed.');
  end if;
  if v_assessment.revision <> p_expected_revision then
    perform app_private.raise_api_error(
      'REVISION_MISMATCH',
      jsonb_build_object('currentRevision', v_assessment.revision)::text
    );
  end if;
  if v_assessment.status <> 'ready' then
    perform app_private.raise_api_error('ASSESSMENT_INCOMPLETE', 'Every required step must be complete.');
  end if;

  select * into v_inputs
  from public.assessment_core_inputs as i
  where i.assessment_id = p_assessment_id
  for update;

  perform app_private.validate_inputs(
    v_inputs.sex_for_calorie_estimation,
    v_inputs.primary_goal,
    v_inputs.age_years,
    v_inputs.height_cm,
    v_inputs.weight_kg,
    v_inputs.target_weight_kg,
    v_inputs.activity_level
  );

  if p_result is null
     or jsonb_typeof(p_result) <> 'object'
     or not (p_result ?& array[
       'algorithmVersion',
       'bmi',
       'bmiCategory',
       'bmrKcal',
       'tdeeKcal',
       'calorieEstimateAvailable',
       'exactDailyCalories',
       'calorieRange',
       'targetDate',
       'weightProjection',
       'warnings',
       'calculatedAt'
     ])
     or (
       p_result - array[
         'algorithmVersion',
         'bmi',
         'bmiCategory',
         'bmrKcal',
         'tdeeKcal',
         'calorieEstimateAvailable',
         'exactDailyCalories',
         'calorieRange',
         'targetDate',
         'weightProjection',
         'warnings',
         'calculatedAt'
       ]
     ) <> '{}'::jsonb then
    perform app_private.raise_api_error('INVALID_RESULT', 'Server result payload has an invalid shape.');
  end if;

  if jsonb_typeof(p_result -> 'algorithmVersion') <> 'string'
     or p_result ->> 'algorithmVersion' <> 'health-v1'
     or jsonb_typeof(p_result -> 'bmi') <> 'number'
     or jsonb_typeof(p_result -> 'bmiCategory') <> 'string'
     or jsonb_typeof(p_result -> 'bmrKcal') <> 'number'
     or jsonb_typeof(p_result -> 'tdeeKcal') <> 'number'
     or jsonb_typeof(p_result -> 'calorieEstimateAvailable') <> 'boolean'
     or jsonb_typeof(p_result -> 'weightProjection') <> 'array'
     or jsonb_typeof(p_result -> 'warnings') <> 'array'
     or jsonb_typeof(p_result -> 'calculatedAt') <> 'string' then
    perform app_private.raise_api_error('INVALID_RESULT', 'Server result payload has invalid scalar types.');
  end if;

  if jsonb_typeof(p_result -> 'exactDailyCalories') not in ('number', 'null')
     or jsonb_typeof(p_result -> 'calorieRange') not in ('object', 'null')
     or jsonb_typeof(p_result -> 'targetDate') not in ('string', 'null') then
    perform app_private.raise_api_error('INVALID_RESULT', 'Server result payload has invalid nullable fields.');
  end if;

  v_bmi := (p_result ->> 'bmi')::numeric;
  v_bmi_category := p_result ->> 'bmiCategory';
  if (p_result ->> 'bmrKcal')::numeric <> trunc((p_result ->> 'bmrKcal')::numeric)
     or (p_result ->> 'tdeeKcal')::numeric <> trunc((p_result ->> 'tdeeKcal')::numeric) then
    perform app_private.raise_api_error('INVALID_RESULT', 'Rounded BMR and TDEE must be integers.');
  end if;
  v_bmr := (p_result ->> 'bmrKcal')::integer;
  v_tdee := (p_result ->> 'tdeeKcal')::integer;
  v_available := (p_result ->> 'calorieEstimateAvailable')::boolean;
  v_projection := p_result -> 'weightProjection';
  v_warnings := p_result -> 'warnings';

  if not app_private.is_valid_projection(v_projection)
     or not app_private.is_warning_array(v_warnings) then
    perform app_private.raise_api_error('INVALID_RESULT', 'Projection or warning codes are invalid.');
  end if;

  begin
    v_calculated_at := (p_result ->> 'calculatedAt')::timestamptz;
    if jsonb_typeof(p_result -> 'targetDate') = 'string' then
      if (p_result ->> 'targetDate') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise invalid_datetime_format;
      end if;
      v_target_date := (p_result ->> 'targetDate')::date;
    else
      v_target_date := null;
    end if;
  exception when others then
    perform app_private.raise_api_error('INVALID_RESULT', 'calculatedAt or targetDate is invalid.');
  end;
  v_calculated_date := (v_calculated_at at time zone 'UTC')::date;

  if jsonb_typeof(p_result -> 'exactDailyCalories') = 'number' then
    if (p_result ->> 'exactDailyCalories')::numeric
       <> trunc((p_result ->> 'exactDailyCalories')::numeric) then
      perform app_private.raise_api_error('INVALID_RESULT', 'exactDailyCalories must be an integer.');
    end if;
    v_exact := (p_result ->> 'exactDailyCalories')::integer;
  else
    v_exact := null;
  end if;

  if jsonb_typeof(p_result -> 'calorieRange') = 'object' then
    if not ((p_result -> 'calorieRange') ?& array['min', 'max'])
       or ((p_result -> 'calorieRange') - array['min', 'max']) <> '{}'::jsonb
       or jsonb_typeof(p_result -> 'calorieRange' -> 'min') <> 'number'
       or jsonb_typeof(p_result -> 'calorieRange' -> 'max') <> 'number'
       or (p_result -> 'calorieRange' ->> 'min')::numeric
          <> trunc((p_result -> 'calorieRange' ->> 'min')::numeric)
       or (p_result -> 'calorieRange' ->> 'max')::numeric
          <> trunc((p_result -> 'calorieRange' ->> 'max')::numeric) then
      perform app_private.raise_api_error('INVALID_RESULT', 'calorieRange must contain integer min and max.');
    end if;
    v_range_min := (p_result -> 'calorieRange' ->> 'min')::integer;
    v_range_max := (p_result -> 'calorieRange' ->> 'max')::integer;
  else
    v_range_min := null;
    v_range_max := null;
  end if;

  -- Independently recompute frozen health-v1 intermediate values from the
  -- persisted canonical inputs. This guards against a server serializer or
  -- algorithm wiring error without trusting client-provided calculations.
  v_bmi_raw := v_inputs.weight_kg / ((v_inputs.height_cm / 100) ^ 2);
  v_bmi_category := case
    when v_bmi_raw < 18.5 then 'underweight'
    when v_bmi_raw < 25 then 'healthy_weight'
    when v_bmi_raw < 30 then 'overweight'
    else 'obesity'
  end;

  v_base_raw := 10 * v_inputs.weight_kg
    + 6.25 * v_inputs.height_cm
    - 5 * v_inputs.age_years;
  v_bmr_raw := v_base_raw
    + case when v_inputs.sex_for_calorie_estimation = 'female' then -161 else 5 end;
  v_activity_factor := case v_inputs.activity_level
    when 'sedentary' then 1.200
    when 'light' then 1.375
    when 'moderate' then 1.550
    when 'active' then 1.725
    when 'very_active' then 1.900
  end;
  v_tdee_raw := v_bmr_raw * v_activity_factor;
  v_calorie_raw := case v_inputs.primary_goal
    when 'lose_weight' then v_tdee_raw - least(500::numeric, v_tdee_raw * 0.20)
    when 'gain_weight' then v_tdee_raw + least(300::numeric, v_tdee_raw * 0.12)
    else v_tdee_raw
  end;
  v_floor := case when v_inputs.sex_for_calorie_estimation = 'female' then 1200 else 1500 end;
  v_available := v_calorie_raw between v_floor and 4500;
  v_bmr := round(v_bmr_raw)::integer;
  v_tdee := round(v_tdee_raw)::integer;

  if v_bmi <> round(v_bmi_raw, 1)
     or (p_result ->> 'bmiCategory') <> v_bmi_category
     or (p_result ->> 'bmrKcal')::integer <> v_bmr
     or (p_result ->> 'tdeeKcal')::integer <> v_tdee
     or (p_result ->> 'calorieEstimateAvailable')::boolean <> v_available then
    perform app_private.raise_api_error('RESULT_MISMATCH', 'Result does not match frozen health-v1 calculations.');
  end if;

  if v_available then
    v_exact := round(v_calorie_raw)::integer;
    -- health-v1 first rounds the exact recommendation to an integer, then
    -- rounds that persisted integer to the nearest hundred for the preview.
    v_range_center := (round(v_exact::numeric / 100) * 100)::integer;
    v_range_min := greatest(v_floor, v_range_center - 100);
    v_range_max := least(4500, v_range_center + 100);

    if (p_result ->> 'exactDailyCalories')::integer is distinct from v_exact
       or (p_result -> 'calorieRange' ->> 'min')::integer is distinct from v_range_min
       or (p_result -> 'calorieRange' ->> 'max')::integer is distinct from v_range_max then
      perform app_private.raise_api_error('RESULT_MISMATCH', 'Calorie result does not match health-v1.');
    end if;
  else
    if jsonb_typeof(p_result -> 'exactDailyCalories') <> 'null'
       or jsonb_typeof(p_result -> 'calorieRange') <> 'null'
       or v_target_date is not null
       or jsonb_array_length(v_projection) <> 0
       or jsonb_array_length(v_warnings) <> 1
       or not (v_warnings ? 'PROFESSIONAL_GUIDANCE_RECOMMENDED') then
      perform app_private.raise_api_error(
        'RESULT_MISMATCH',
        'Unavailable estimates must omit exact values, date and projection and carry the guidance warning.'
      );
    end if;
    v_exact := null;
    v_range_min := null;
    v_range_max := null;
  end if;

  if v_available then
    if v_inputs.primary_goal = 'maintain_weight' then
      if v_target_date is not null
         or jsonb_array_length(v_projection) <> 1
         or jsonb_array_length(v_warnings) <> 1
         or not (v_warnings ? 'MAINTENANCE_GOAL_NO_ARRIVAL_DATE') then
        perform app_private.raise_api_error('RESULT_MISMATCH', 'Maintenance result shape is invalid.');
      end if;

      v_item := v_projection -> 0;
      if (v_item ->> 'date')::date <> v_calculated_date
         or (v_item ->> 'weightKg')::numeric <> round(v_inputs.weight_kg, 1) then
        perform app_private.raise_api_error('RESULT_MISMATCH', 'Maintenance baseline point is invalid.');
      end if;
    else
      v_weekly_rate := abs(v_tdee_raw - v_calorie_raw) * 7 / 7700;
      if v_inputs.primary_goal = 'lose_weight' then
        v_weekly_rate := least(v_weekly_rate, 0.907::numeric, v_inputs.weight_kg * 0.01);
      else
        v_weekly_rate := least(v_weekly_rate, 0.454::numeric, v_inputs.weight_kg * 0.005);
      end if;
      v_weeks := ceil(abs(v_inputs.weight_kg - v_inputs.target_weight_kg) / v_weekly_rate)::integer;

      if v_weeks > 104 then
        if v_target_date is not null
           or jsonb_array_length(v_projection) <> 0
           or jsonb_array_length(v_warnings) <> 1
           or not (v_warnings ? 'PREDICTION_HORIZON_EXCEEDED') then
          perform app_private.raise_api_error('RESULT_MISMATCH', 'Long-horizon prediction shape is invalid.');
        end if;
      else
        if v_target_date is distinct from (v_calculated_date + (v_weeks * 7))
           or jsonb_array_length(v_projection) <> v_weeks + 1
           or jsonb_array_length(v_warnings) <> 0 then
          perform app_private.raise_api_error('RESULT_MISMATCH', 'Prediction date, point count or warnings are invalid.');
        end if;

        for v_index in 0..v_weeks
        loop
          v_item := v_projection -> v_index;
          v_expected_date := v_calculated_date + (v_index * 7);
          if v_index = v_weeks then
            v_expected_weight := round(v_inputs.target_weight_kg, 1);
          elsif v_inputs.primary_goal = 'lose_weight' then
            v_expected_weight := round(
              greatest(v_inputs.target_weight_kg, v_inputs.weight_kg - v_weekly_rate * v_index),
              1
            );
          else
            v_expected_weight := round(
              least(v_inputs.target_weight_kg, v_inputs.weight_kg + v_weekly_rate * v_index),
              1
            );
          end if;

          if (v_item ->> 'date')::date <> v_expected_date
             or (v_item ->> 'weightKg')::numeric <> v_expected_weight then
            perform app_private.raise_api_error(
              'RESULT_MISMATCH',
              'Projection point ' || v_index::text || ' is invalid.'
            );
          end if;
        end loop;
      end if;
    end if;
  end if;

  v_snapshot := jsonb_build_object(
    'quizVersion', v_assessment.quiz_version,
    'inputRevision', v_assessment.revision,
    'sexForCalorieEstimation', v_inputs.sex_for_calorie_estimation,
    'primaryGoal', v_inputs.primary_goal,
    'ageYears', v_inputs.age_years,
    'heightCm', v_inputs.height_cm,
    'weightKg', v_inputs.weight_kg,
    'targetWeightKg', v_inputs.target_weight_kg,
    'activityLevel', v_inputs.activity_level
  );

  insert into public.assessment_results (
    assessment_id,
    algorithm_version,
    input_revision,
    input_snapshot,
    bmi_raw,
    bmi,
    bmi_category,
    calorie_range_min,
    calorie_range_max,
    calorie_estimate_available,
    warnings,
    calculated_at
  ) values (
    p_assessment_id,
    'health-v1',
    v_assessment.revision,
    v_snapshot,
    v_bmi_raw,
    round(v_bmi_raw, 1),
    v_bmi_category,
    v_range_min,
    v_range_max,
    v_available,
    v_warnings,
    v_calculated_at
  )
  returning id into v_result_id;

  insert into public.assessment_result_details (
    result_id,
    bmr_raw,
    tdee_raw,
    calorie_target_raw,
    bmr_kcal,
    tdee_kcal,
    exact_daily_calories,
    target_date,
    weight_projection
  ) values (
    v_result_id,
    v_bmr_raw,
    v_tdee_raw,
    v_calorie_raw,
    v_bmr,
    v_tdee,
    v_exact,
    v_target_date,
    v_projection
  );

  update public.assessments
  set status = 'completed',
      revision = revision + 1,
      submitted_at = v_calculated_at
  where id = p_assessment_id;

  v_payload := jsonb_build_object(
    'assessmentId', p_assessment_id,
    'resultId', v_result_id,
    'status', 'completed',
    'revision', v_assessment.revision + 1,
    'calculatedAt', v_calculated_at
  );

  perform app_private.record_idempotency(
    v_session.session_user_id,
    p_assessment_id,
    v_scope,
    p_idempotency_key,
    p_request_hash,
    'result',
    v_result_id,
    200::smallint,
    v_payload
  );

  return jsonb_build_object(
    'replayed', false,
    'responseStatus', 200,
    'payload', v_payload
  );
end;
$$;

create function public.rpc_get_assessment_result(
  p_session_hash bytea,
  p_assessment_id uuid
)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  v_session record;
  v_assessment public.assessments%rowtype;
  v_result public.assessment_results%rowtype;
  v_details public.assessment_result_details%rowtype;
  v_entitled boolean;
  v_range jsonb;
begin
  select * into v_session
  from app_private.resolve_session(p_session_hash, false, true);

  select * into v_assessment
  from public.assessments as a
  where a.id = p_assessment_id
    and a.user_id = v_session.session_user_id;

  if not found then
    perform app_private.raise_api_error('ASSESSMENT_NOT_FOUND', 'Assessment was not found.');
  end if;
  if v_assessment.status <> 'completed' then
    perform app_private.raise_api_error('RESULT_NOT_READY', 'Assessment has not been submitted.');
  end if;

  select * into v_result
  from public.assessment_results as r
  where r.assessment_id = p_assessment_id;

  if not found then
    perform app_private.raise_api_error('RESULT_NOT_READY', 'Persisted result is unavailable.');
  end if;

  select exists (
    select 1
    from public.subscriptions as s
    where s.user_id = v_session.session_user_id
      and s.status = 'active'
      and s.valid_from <= transaction_timestamp()
      and (s.valid_until is null or s.valid_until > transaction_timestamp())
  ) into v_entitled;

  v_range := case
    when v_result.calorie_estimate_available then jsonb_build_object(
      'min', v_result.calorie_range_min,
      'max', v_result.calorie_range_max
    )
    else 'null'::jsonb
  end;

  if not v_entitled then
    -- Do not touch the protected details table on this branch. The physical
    -- split and this explicit allowlist jointly prevent preview leakage.
    return jsonb_build_object(
      'access', 'preview',
      'assessmentId', p_assessment_id,
      'resultId', v_result.id,
      'bmi', v_result.bmi,
      'bmiCategory', v_result.bmi_category,
      'summary', 'A gradual plan is recommended.',
      'calorieRange', v_range,
      'warnings', v_result.warnings,
      'upgradeRequired', true,
      'lockedFeatures', jsonb_build_array(
        'bmrKcal',
        'tdeeKcal',
        'exactDailyCalories',
        'targetDate',
        'weightProjection'
      )
    );
  end if;

  select * into v_details
  from public.assessment_result_details as d
  where d.result_id = v_result.id;

  if not found then
    perform app_private.raise_api_error('RESULT_NOT_READY', 'Protected result details are unavailable.');
  end if;

  return jsonb_build_object(
    'access', 'full',
    'assessmentId', p_assessment_id,
    'resultId', v_result.id,
    'bmi', v_result.bmi,
    'bmiCategory', v_result.bmi_category,
    'bmrKcal', v_details.bmr_kcal,
    'tdeeKcal', v_details.tdee_kcal,
    'exactDailyCalories', v_details.exact_daily_calories,
    'calorieEstimateAvailable', v_result.calorie_estimate_available,
    'calorieRange', v_range,
    'targetDate', v_details.target_date,
    'weightProjection', v_details.weight_projection,
    'warnings', v_result.warnings,
    'algorithmVersion', v_result.algorithm_version,
    'calculatedAt', v_result.calculated_at
  );
end;
$$;

create function public.rpc_simulate_payment(
  p_session_hash bytea,
  p_assessment_id uuid,
  p_plan_code text,
  p_idempotency_key text,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  v_session record;
  v_scope text;
  v_replay jsonb;
  v_assessment public.assessments%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_payment_event_id uuid;
  v_provider_event_id text;
  v_now timestamptz := transaction_timestamp();
  v_outcome text;
  v_payload jsonb;
begin
  select * into v_session
  from app_private.resolve_session(p_session_hash, true, true);

  if p_assessment_id is null then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'assessmentId is required.');
  end if;
  if p_plan_code is null or p_plan_code <> 'demo_monthly' then
    perform app_private.raise_api_error('VALIDATION_FAILED', 'Unsupported planCode.');
  end if;

  -- /pay is a single route-level idempotency namespace. assessmentId is part
  -- of the canonical request hash, so reusing a key for another assessment
  -- deterministically returns IDEMPOTENCY_KEY_REUSED instead of a raw unique
  -- constraint error.
  v_scope := 'payment';
  v_replay := app_private.get_idempotency_replay(
    v_session.session_user_id,
    v_scope,
    p_idempotency_key,
    p_request_hash
  );
  if v_replay is not null then
    return v_replay;
  end if;

  -- Payment attempt keys remain in the immutable audit after the 24-hour
  -- replay payload expires. Reject permanent key reuse with a stable domain
  -- error instead of leaking a provider-event unique-constraint failure.
  if exists (
    select 1
    from public.payment_events as pe
    where pe.provider = 'mock'
      and pe.user_id = v_session.session_user_id
      and pe.idempotency_key = p_idempotency_key
  ) then
    perform app_private.raise_api_error(
      'IDEMPOTENCY_KEY_REUSED',
      'This payment key is already present in the immutable audit.'
    );
  end if;

  select * into v_assessment
  from public.assessments as a
  where a.id = p_assessment_id
    and a.user_id = v_session.session_user_id
  for update;

  if not found then
    perform app_private.raise_api_error('ASSESSMENT_NOT_FOUND', 'Assessment was not found.');
  end if;
  if v_assessment.status <> 'completed' then
    perform app_private.raise_api_error('PAYMENT_REQUIRES_RESULT', 'Submit the assessment before payment.');
  end if;

  -- All payment keys for one user serialize on entitlement state. This permits
  -- separate attempt events while preventing renewal/extension races.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('subscription:' || v_session.session_user_id::text, 0)
  );

  select * into v_subscription
  from public.subscriptions as s
  where s.user_id = v_session.session_user_id
  for update;

  if found
     and v_subscription.status = 'active'
     and v_subscription.valid_from <= v_now
     and (v_subscription.valid_until is null or v_subscription.valid_until > v_now) then
    v_outcome := 'already_active';
  elsif found then
    update public.subscriptions
    set status = 'active',
        plan_code = p_plan_code,
        valid_from = v_now,
        valid_until = v_now + interval '30 days',
        revision = revision + 1
    where id = v_subscription.id
    returning * into v_subscription;
    v_outcome := 'activated';
  else
    insert into public.subscriptions (
      user_id,
      status,
      plan_code,
      valid_from,
      valid_until
    ) values (
      v_session.session_user_id,
      'active',
      p_plan_code,
      v_now,
      v_now + interval '30 days'
    )
    returning * into v_subscription;
    v_outcome := 'activated';
  end if;

  v_provider_event_id := 'mock_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.payment_events (
    user_id,
    assessment_id,
    provider,
    provider_event_id,
    idempotency_key,
    plan_code,
    outcome,
    processed_at
  ) values (
    v_session.session_user_id,
    p_assessment_id,
    'mock',
    v_provider_event_id,
    p_idempotency_key,
    p_plan_code,
    v_outcome,
    v_now
  )
  returning id into v_payment_event_id;

  v_payload := jsonb_build_object(
    'paymentEventId', v_payment_event_id,
    'assessmentId', p_assessment_id,
    'outcome', v_outcome,
    'subscription', jsonb_build_object(
      'status', v_subscription.status,
      'planCode', v_subscription.plan_code,
      'validFrom', v_subscription.valid_from,
      'validUntil', v_subscription.valid_until,
      'revision', v_subscription.revision
    )
  );

  perform app_private.record_idempotency(
    v_session.session_user_id,
    p_assessment_id,
    v_scope,
    p_idempotency_key,
    p_request_hash,
    'payment_event',
    v_payment_event_id,
    200::smallint,
    v_payload
  );

  return jsonb_build_object(
    'replayed', false,
    'responseStatus', 200,
    'payload', v_payload
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Data API boundary
-- ---------------------------------------------------------------------------
-- Every business table lives in an exposed schema, therefore RLS is enabled
-- even though browser roles receive no table privileges and no policies. The
-- server secret assumes service_role (BYPASSRLS) and may invoke only the RPCs
-- granted below. Ownership/BOLA checks remain inside those transactions.

alter table public.app_users enable row level security;
alter table public.anonymous_sessions enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_core_inputs enable row level security;
alter table public.assessment_results enable row level security;
alter table public.assessment_result_details enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payment_events enable row level security;
alter table public.idempotency_records enable row level security;

revoke all on all tables in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke execute on all functions in schema public from public, anon, authenticated, service_role;
revoke all on schema app_private from public, anon, authenticated, service_role;
revoke execute on all functions in schema app_private from public, anon, authenticated, service_role;

grant usage on schema public, app_private to service_role;

grant select, insert on table public.app_users to service_role;
grant update (last_seen_at) on table public.app_users to service_role;
grant select, insert on table public.anonymous_sessions to service_role;
grant update (revoked_at) on table public.anonymous_sessions to service_role;
grant select, insert on table public.assessments to service_role;
grant update (status, revision, submitted_at) on table public.assessments to service_role;
grant select, insert on table public.assessment_core_inputs to service_role;
grant update (
  sex_for_calorie_estimation,
  primary_goal,
  age_years,
  height_cm,
  weight_kg,
  target_weight_kg,
  activity_level
) on table public.assessment_core_inputs to service_role;
grant select, insert on table public.assessment_results to service_role;
grant select, insert on table public.assessment_result_details to service_role;
grant select, insert on table public.subscriptions to service_role;
grant update (status, plan_code, valid_from, valid_until, revision)
  on table public.subscriptions to service_role;
grant select, insert on table public.payment_events to service_role;
grant select, insert, delete on table public.idempotency_records to service_role;
-- PostgreSQL requires UPDATE privilege on at least one column for SELECT ...
-- FOR UPDATE. The immutable-update trigger still rejects every actual update.
grant update (id) on table public.idempotency_records to service_role;

-- Private helpers are outside the Data API exposed schemas. SECURITY INVOKER
-- public RPCs still need to execute them as service_role.
grant execute on all functions in schema app_private to service_role;

grant execute on function public.rpc_create_anonymous_session(bytea, timestamptz)
  to service_role;
grant execute on function public.rpc_resolve_session(bytea)
  to service_role;
grant execute on function public.rpc_create_or_get_assessment(bytea, text, text, bytea)
  to service_role;
grant execute on function public.rpc_get_current_assessment(bytea)
  to service_role;
grant execute on function public.rpc_get_assessment(bytea, uuid)
  to service_role;
grant execute on function public.rpc_fetch_ready_inputs(bytea, uuid)
  to service_role;
grant execute on function public.rpc_save_assessment_step(bytea, uuid, text, jsonb, bigint, text, bytea)
  to service_role;
grant execute on function public.rpc_finalize_assessment(bytea, uuid, bigint, text, bytea, jsonb)
  to service_role;
grant execute on function public.rpc_get_assessment_result(bytea, uuid)
  to service_role;
grant execute on function public.rpc_simulate_payment(bytea, uuid, text, text, bytea)
  to service_role;

comment on schema app_private is
  'Non-exposed helpers for session resolution, invariants and transaction RPCs.';
comment on function public.rpc_get_assessment_result(bytea, uuid) is
  'Returns an allow-listed preview or full result according to live entitlement.';

commit;
