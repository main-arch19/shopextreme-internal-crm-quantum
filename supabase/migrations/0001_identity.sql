-- 0001_identity.sql
-- Employees, invites, and the single authorization helper every RLS policy in
-- this system gates on (§9.1).
--
-- The design principle: authorization is re-read from the database on every
-- query, not decided once at login. A suspended employee's access token stays
-- cryptographically valid until it expires, but is_active_employee() returns
-- false on their very next request and every policy denies. Token still
-- authenticates; it no longer authorizes (§9.3).

create type employee_status as enum ('pending','active','suspended','offboarded');
create type employee_role   as enum ('pending','viewer','buyer','manager','executive');

create table employees (
  id             uuid primary key references auth.users(id),
  email          text unique not null,
  full_name      text,
  role           employee_role not null default 'pending',
  status         employee_status not null default 'pending',
  requested_at   timestamptz default now(),
  approved_at    timestamptz,
  approved_by    uuid references employees(id),
  suspended_at   timestamptz,
  offboarded_at  timestamptz,
  removed_by     uuid references employees(id),
  removal_reason text,
  last_active_at timestamptz
);

create index on employees (status, role);
create index on employees (email);

create table employee_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        employee_role not null,
  token_hash  text not null unique,      -- store the hash, never the token
  invited_by  uuid not null references employees(id),
  invited_at  timestamptz default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  consumed_at timestamptz,
  revoked_at  timestamptz
);

create index on employee_invites (email) where consumed_at is null and revoked_at is null;
create index on employee_invites (token_hash);

-- An invite must never be issued at 'pending' — that role exists only as the
-- default for rows created outside the invite flow, and grants nothing.
alter table employee_invites
  add constraint invite_role_is_grantable check (role <> 'pending');


-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

-- security definer so the function can read employees regardless of the
-- caller's own RLS grants — otherwise the policy that gates employees would
-- need to call itself.
create or replace function is_active_employee()
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from employees
    where id = auth.uid() and status = 'active' and role <> 'pending'
  );
$$;

-- Ordinal comparison for role gates. Postgres enums compare by declaration
-- order, so 'manager' >= 'buyer' is already true; this wrapper exists so the
-- active-status check is never accidentally omitted at a call site.
create or replace function has_role(min_role employee_role)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from employees
    where id = auth.uid()
      and status = 'active'
      and role <> 'pending'
      and role >= min_role
  );
$$;

create or replace function current_employee_role()
returns employee_role language sql stable security definer
set search_path = public as $$
  select role from employees where id = auth.uid() and status = 'active';
$$;


-- ---------------------------------------------------------------------------
-- Guardrails (§9.3) — enforced in the database, not the UI
-- ---------------------------------------------------------------------------

-- The last active executive cannot be removed or demoted. Without this, a bad
-- sequence of role changes locks everyone out of the executive section
-- permanently, recoverable only via direct database access.
create or replace function guard_last_executive()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_remaining integer;
begin
  -- Only relevant when this row is losing active-executive standing.
  if old.role = 'executive' and old.status = 'active'
     and (new.role <> 'executive' or new.status <> 'active') then

    select count(*) into v_remaining
    from employees
    where role = 'executive' and status = 'active' and id <> old.id;

    if v_remaining = 0 then
      raise exception
        'cannot remove or demote the last active executive (employee %)', old.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end; $$;

create trigger employees_guard_last_executive
  before update on employees
  for each row execute function guard_last_executive();

-- An executive cannot remove their own account. In the UI the control is
-- absent, not disabled; this is the backstop for the API path.
create or replace function guard_self_removal()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is not null
     and auth.uid() = old.id
     and new.status in ('suspended','offboarded')
     and old.status not in ('suspended','offboarded') then
    raise exception 'an employee cannot suspend or offboard their own account'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

create trigger employees_guard_self_removal
  before update on employees
  for each row execute function guard_self_removal();

-- Offboarding requires a stated reason, which goes in the log (§9.3).
alter table employees add constraint offboard_requires_reason
  check (status <> 'offboarded' or removal_reason is not null);


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table employees enable row level security;
alter table employee_invites enable row level security;

-- Every active employee can see the roster — including former staff, which is
-- deliberate: hiding them makes the roster tidier and the history harder to
-- audit (§9.3).
create policy employees_read on employees
  for select using (is_active_employee());

-- A pending user must be able to read their own row, or the waiting-for-
-- approval screen cannot tell them what state they are in.
create policy employees_read_self on employees
  for select using (id = auth.uid());

-- Role and status changes are executive-only, and go through server routes
-- that write the audit entry in the same transaction.
create policy employees_write on employees
  for update using (has_role('executive')) with check (has_role('executive'));

-- Deletion is the tampering vector the audit log exists to prevent (§9.3).
-- No policy grants it, and the grant is revoked outright below.
revoke delete on employees from anon, authenticated;

create policy invites_read on employee_invites
  for select using (has_role('executive'));

create policy invites_write on employee_invites
  for all using (has_role('executive')) with check (has_role('executive'));
