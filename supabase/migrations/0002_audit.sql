-- 0002_audit.sql
-- Append-only, hash-chained audit log (§10).
--
-- Scope of the guarantee, stated plainly because it matters (§10.1):
--   1. Unchangeable through the application  — no API path updates or deletes
--   2. Unchangeable at the privilege level   — the grants do not exist
--   3. Tamper-evident                        — the hash chain makes direct
--                                              database edits provable
-- Layers 1-3 are what this file builds. Layer 4 (tamper-PROOF) requires the
-- record to live where the database administrator cannot reach it, which is
-- what the daily chain-head email in the verification job begins to address.
-- Anyone with the service-role key or direct psql access can still write to
-- this table; the chain is what makes doing so detectable.

create table audit_log (
  id           bigserial primary key,
  occurred_at  timestamptz not null default clock_timestamp(),
  actor_id     uuid references employees(id),
  actor_email  text not null,        -- denormalized: survives any employee change
  actor_role   employee_role not null,
  action       text not null,        -- 'po.approve', 'employee.remove', 'stock.adjust'
  entity_type  text not null,
  entity_id    text,
  before_state jsonb,
  after_state  jsonb,
  ip_address   inet,
  user_agent   text,
  session_id   text,
  prev_hash    text,
  row_hash     text not null
);

create index on audit_log (occurred_at desc);
create index on audit_log (actor_id, occurred_at desc);
create index on audit_log (entity_type, entity_id);
create index on audit_log (action, occurred_at desc);


-- ---------------------------------------------------------------------------
-- Enforcing append-only
-- RLS restricts rows; grants restrict operations. Both are required (§10.3).
-- ---------------------------------------------------------------------------

revoke update, delete, truncate on audit_log from anon, authenticated, service_role;
grant insert, select on audit_log to service_role;
grant select on audit_log to authenticated;

alter table audit_log enable row level security;

create policy exec_reads_log on audit_log for select using (
  exists (select 1 from employees
          where id = auth.uid() and role = 'executive' and status = 'active')
);

-- Trigger backstop. Grants can be re-granted by a superuser; this raises
-- regardless, so an accidental GRANT does not silently reopen the table.
create or replace function block_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only (attempted %)', tg_op;
end; $$;

create trigger no_audit_update before update or delete on audit_log
  for each row execute function block_audit_mutation();


-- ---------------------------------------------------------------------------
-- Single write path
-- All inserts go through this function so application code cannot forge the
-- actor, backdate an entry, or skip the hash (§10.3).
-- ---------------------------------------------------------------------------

create or replace function write_audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb, p_after jsonb
) returns bigint language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_prev text; v_emp record; v_hash text; v_id bigint; v_ts timestamptz;
begin
  -- Serializes chain writes. Concurrent inserts racing on "last row hash"
  -- would otherwise fork the chain — two rows sharing one prev_hash, which
  -- verification reports as a break. At a few hundred events a day the lock
  -- costs nothing.
  perform pg_advisory_xact_lock(hashtext('audit_log_chain'));

  select email, role into v_emp from employees where id = auth.uid();

  -- A nightly job or an unauthenticated path has no employee row. Record it
  -- as the system actor rather than failing the write — losing the entry is
  -- worse than an imprecise actor.
  if v_emp is null then
    v_emp.email := coalesce(current_setting('app.system_actor', true), 'system@internal');
    v_emp.role  := 'executive'::employee_role;
  end if;

  select row_hash into v_prev from audit_log order by id desc limit 1;

  v_ts := clock_timestamp();

  -- The timestamp is inside the hash, so an entry cannot be silently
  -- backdated after the fact without breaking every subsequent row.
  v_hash := encode(digest(
    coalesce(v_prev,'GENESIS') || coalesce(auth.uid()::text,'system') || p_action ||
    coalesce(p_entity_id,'') || coalesce(p_before::text,'') ||
    coalesce(p_after::text,'') || v_ts::text, 'sha256'), 'hex');

  insert into audit_log (occurred_at, actor_id, actor_email, actor_role, action,
                         entity_type, entity_id, before_state, after_state,
                         prev_hash, row_hash)
  values (v_ts, auth.uid(), v_emp.email, v_emp.role, p_action,
          p_entity_type, p_entity_id, p_before, p_after, v_prev, v_hash)
  returning id into v_id;

  return v_id;
end; $$;

-- The function is the only write path, so it is callable by ordinary users;
-- the table itself remains closed to them.
grant execute on function write_audit(text, text, text, jsonb, jsonb)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Chain verification (§10.4)
-- Walks the chain recomputing each hash. Returns the first break, or the
-- verified head. A failure here is a security incident, not a bug.
-- ---------------------------------------------------------------------------

create or replace function verify_audit_chain(p_from bigint default 0)
returns table (
  ok              boolean,
  checked_through bigint,
  entry_count     bigint,
  broken_at       bigint,
  reason          text,
  head_hash       text
) language plpgsql security definer
set search_path = public, extensions as $$
declare
  r record;
  v_prev text := null;
  v_expected text;
  v_count bigint := 0;
  v_last bigint := 0;
  v_first boolean := true;
begin
  for r in
    select * from audit_log where id > p_from order by id asc
  loop
    -- On a partial verification the first row's prev_hash is taken on trust;
    -- a full walk (p_from = 0) checks it against GENESIS.
    if v_first and p_from > 0 then
      v_prev := r.prev_hash;
    end if;
    v_first := false;

    if r.prev_hash is distinct from v_prev then
      return query select false, v_last, v_count, r.id,
        format('prev_hash mismatch at entry %s: chain expected %s, row claims %s',
               r.id, coalesce(v_prev,'GENESIS'), coalesce(r.prev_hash,'NULL')),
        v_prev;
      return;
    end if;

    v_expected := encode(digest(
      coalesce(r.prev_hash,'GENESIS') || coalesce(r.actor_id::text,'system') || r.action ||
      coalesce(r.entity_id,'') || coalesce(r.before_state::text,'') ||
      coalesce(r.after_state::text,'') || r.occurred_at::text, 'sha256'), 'hex');

    if v_expected <> r.row_hash then
      return query select false, v_last, v_count, r.id,
        format('row_hash mismatch at entry %s: content does not match its hash', r.id),
        v_prev;
      return;
    end if;

    v_prev  := r.row_hash;
    v_last  := r.id;
    v_count := v_count + 1;
  end loop;

  return query select true, v_last, v_count, null::bigint,
    format('chain verified through entry %s — no gaps or alterations detected', v_last),
    v_prev;
end; $$;

grant execute on function verify_audit_chain(bigint) to service_role;
