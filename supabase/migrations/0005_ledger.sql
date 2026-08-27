-- 0005_ledger.sql
-- The stock ledger (§4.3) and derived on-hand (§4.4).
--
-- On-hand is the sum of the ledger. Always derived, never stored as a truth
-- of its own. This is the most important rule in the system: every change
-- carries an author, a timestamp, a reason, and a document it belongs to, so
-- nothing moves anonymously and any number on screen can be reconstructed.

create table stock_movements (
  id          bigserial primary key,
  item_id     uuid not null references items(id),
  location_id uuid not null references locations(id),
  quantity    numeric(12,3) not null,      -- signed
  unit_cost   numeric(12,2),
  document_id uuid not null references documents(id),
  doc_type    doc_type not null,
  occurred_at timestamptz not null,
  posted_at   timestamptz not null default now(),
  posted_by   uuid references employees(id),

  -- A zero-quantity movement is noise in the ledger and a bug upstream.
  constraint movement_quantity_nonzero check (quantity <> 0)
);

create index on stock_movements (item_id, occurred_at desc);
create index on stock_movements (document_id);
create index on stock_movements (location_id, occurred_at desc);
create index on stock_movements (item_id, location_id);
-- Velocity (§5.1) reads issues by item over a trailing window.
create index on stock_movements (item_id, doc_type, occurred_at desc);

-- Same enforcement pattern as the audit log: grants restrict operations, and
-- a trigger backstops the grants in case one is ever re-granted.
revoke update, delete, truncate on stock_movements from anon, authenticated, service_role;
grant insert, select on stock_movements to service_role;
grant select on stock_movements to authenticated;

create or replace function block_movement_mutation()
returns trigger language plpgsql as $$
begin
  raise exception
    'stock_movements is append-only (attempted %) — void the document instead', tg_op;
end; $$;

create trigger no_movement_update before update or delete on stock_movements
  for each row execute function block_movement_mutation();

alter table stock_movements enable row level security;
create policy read_movements on stock_movements
  for select using (is_active_employee());

-- Inserts happen only inside post_document(), which is security definer.
-- No policy grants INSERT to ordinary users, so the ledger cannot be written
-- around the posting engine.


-- ---------------------------------------------------------------------------
-- Derived on-hand (§4.4)
-- ---------------------------------------------------------------------------

create materialized view stock_on_hand as
select item_id, location_id, sum(quantity) as on_hand,
       max(occurred_at) as last_movement_at
from stock_movements
group by item_id, location_id;

-- The unique index is what makes REFRESH ... CONCURRENTLY legal, and
-- concurrent refresh is what keeps refreshes from blocking reads (§12).
create unique index on stock_on_hand (item_id, location_id);
create index on stock_on_hand (location_id);
-- Negative balances are surfaced, not blocked (§4.4).
create index on stock_on_hand (on_hand) where on_hand < 0;

grant select on stock_on_hand to authenticated, service_role;

-- Materialized views do not support RLS. Everything in here is derived from
-- stock_movements, which every active employee may already read in full, so
-- no row is exposed that was not already readable. If per-location
-- restrictions are ever introduced, this view needs revisiting.

-- Per-location recency, for the "last movement recorded" panel that makes
-- silence visible (§3, §7.9). Three days without an entry is an alert, not a
-- gap in a chart.
create view location_activity as
select l.id as location_id, l.code, l.name,
       max(m.occurred_at) as last_movement_at,
       (now() - max(m.occurred_at)) as since_last_movement
from locations l
left join stock_movements m on m.location_id = l.id
where l.is_active
group by l.id, l.code, l.name;

grant select on location_activity to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Refresh helper
-- ---------------------------------------------------------------------------

-- CONCURRENTLY cannot run inside a transaction block, so post_document()
-- cannot call it directly. Posting therefore refreshes non-concurrently
-- inside its transaction (correct, briefly blocking, and fast at this scale),
-- while scheduled jobs use this function.
create or replace function refresh_stock_on_hand()
returns void language plpgsql security definer
set search_path = public as $$
begin
  refresh materialized view concurrently stock_on_hand;
end; $$;

grant execute on function refresh_stock_on_hand() to service_role;
