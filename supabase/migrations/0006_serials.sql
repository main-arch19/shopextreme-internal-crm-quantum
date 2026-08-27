-- 0006_serials.sql
-- Per-unit serial tracking (§14.6).
--
-- Beyond the v3.0 spec, which names serial numbers as a scope question and
-- stops there. Design decided with the client: a per-item flag, so serialized
-- and bulk goods coexist in one ledger.
--
-- Two records per serialized movement:
--   stock_movements  — value and velocity math, identical to bulk items, so
--                      every metric in §5 works without special-casing
--   serial_movements — per-unit custody, so "where is serial X now" is a
--                      lookup rather than a ledger replay
--
-- The seam to watch: on-hand for a serialized item can be computed two ways —
-- counting in_stock serials, or summing the ledger. They must agree, and
-- serial_reconciliation below exists to prove it.

create type serial_status as enum ('in_stock','issued','quarantine','written_off');

create table serial_units (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references items(id),
  serial        text not null,
  location_id   uuid references locations(id),
  status        serial_status not null default 'in_stock',
  received_doc  uuid references documents(id),
  unit_cost     numeric(12,2),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Serials are unique per item, not globally: two manufacturers can each
  -- ship a unit stamped 0001.
  unique (item_id, serial),

  -- A serial that is in stock must be somewhere. One that has left has no
  -- location, and saying otherwise would let it be counted twice.
  constraint in_stock_has_location check (
    (status = 'in_stock') = (location_id is not null)
  ),
  constraint serial_not_blank check (length(trim(serial)) > 0)
);

create index on serial_units (item_id, status);
create index on serial_units (serial);
create index on serial_units (location_id) where status = 'in_stock';
create index on serial_units (item_id, location_id) where status = 'in_stock';

create table serial_movements (
  id             bigserial primary key,
  serial_unit_id uuid not null references serial_units(id),
  document_id    uuid not null references documents(id),
  doc_type       doc_type not null,
  from_location  uuid references locations(id),
  to_location    uuid references locations(id),
  from_status    serial_status,
  to_status      serial_status not null,
  occurred_at    timestamptz not null,
  posted_at      timestamptz not null default now(),
  posted_by      uuid references employees(id)
);

create index on serial_movements (serial_unit_id, occurred_at desc);
create index on serial_movements (document_id);

-- Append-only, same pattern as stock_movements and audit_log.
revoke update, delete, truncate on serial_movements from anon, authenticated, service_role;
grant insert, select on serial_movements to service_role;
grant select on serial_movements to authenticated;

create or replace function block_serial_movement_mutation()
returns trigger language plpgsql as $$
begin
  raise exception
    'serial_movements is append-only (attempted %) — void the document instead', tg_op;
end; $$;

create trigger no_serial_movement_update before update or delete on serial_movements
  for each row execute function block_serial_movement_mutation();

-- serial_units is current-state and therefore mutable, but only by the
-- posting engine. Its full history lives in serial_movements.
create or replace function touch_serial_unit()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

create trigger serial_units_touch
  before update on serial_units
  for each row execute function touch_serial_unit();


-- The line-level FK deferred from 0004, now that the table exists.
alter table document_lines
  add constraint document_lines_serial_unit_fkey
  foreign key (serial_unit_id) references serial_units(id);

create index on document_lines (serial_unit_id) where serial_unit_id is not null;


-- ---------------------------------------------------------------------------
-- Reconciliation (§ verification step 5)
-- ---------------------------------------------------------------------------

-- Counting in_stock serials and summing the ledger must produce the same
-- number. Any row returned here is a bug in the posting engine, and it is the
-- kind of bug that otherwise stays invisible for months.
create view serial_reconciliation as
select
  i.id   as item_id,
  i.sku,
  l.id   as location_id,
  l.code as location_code,
  coalesce(soh.on_hand, 0)      as ledger_on_hand,
  coalesce(su.serial_count, 0)  as serial_count,
  coalesce(soh.on_hand, 0) - coalesce(su.serial_count, 0) as discrepancy
from items i
cross join locations l
left join stock_on_hand soh on soh.item_id = i.id and soh.location_id = l.id
left join (
  select item_id, location_id, count(*)::numeric as serial_count
  from serial_units
  where status = 'in_stock'
  group by item_id, location_id
) su on su.item_id = i.id and su.location_id = l.id
where i.is_serialized
  and (coalesce(soh.on_hand, 0) <> 0 or coalesce(su.serial_count, 0) <> 0)
  and coalesce(soh.on_hand, 0) <> coalesce(su.serial_count, 0);

grant select on serial_reconciliation to authenticated, service_role;


alter table serial_units     enable row level security;
alter table serial_movements enable row level security;

create policy serial_units_read on serial_units
  for select using (is_active_employee());
create policy serial_movements_read on serial_movements
  for select using (is_active_employee());

-- No INSERT/UPDATE policy: serial_units is written only by post_document()
-- and void_document(), which are security definer.

revoke delete on serial_units from anon, authenticated;
