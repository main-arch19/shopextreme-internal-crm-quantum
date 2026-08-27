-- 0004_documents.sql
-- Documents and their lines (§4.2).
--
-- Every stock change is a document. Nobody ever types a new stock number —
-- on-hand is not an editable field anywhere in this system (§2).
--
-- Draft vs posted is the distinction that makes this work: a draft is
-- editable and moves nothing, posting is the commit that writes ledger rows,
-- and from that moment the document is immutable. Corrections happen by
-- voiding and re-entering, never by editing a posted document.
--
-- No customer_id: this deployment is internal-only (§14.1 decided). Issues
-- carry issue_reason alone.

create type doc_type   as enum ('RECEIPT','ISSUE','ADJUSTMENT','COUNT','TRANSFER');
create type doc_status as enum ('DRAFT','POSTED','VOIDED');

create table documents (
  id             uuid primary key default gen_random_uuid(),
  -- Filled by the documents_set_number trigger on insert, so it is nullable
  -- at the column level and enforced by that trigger instead.
  doc_number     text unique,                   -- RCP-000148, ISS-002911
  doc_type       doc_type not null,
  status         doc_status not null default 'DRAFT',
  location_id    uuid references locations(id),
  to_location_id uuid references locations(id),   -- transfers only
  supplier_id    uuid references suppliers(id),   -- receipts only
  issue_reason   text,                            -- sale | internal | sample | damage | writeoff
  reference      text,                            -- their invoice or order number
  reason         text,                            -- required for adjustments
  occurred_at    timestamptz not null default now(),
  posted_at      timestamptz,
  posted_by      uuid references employees(id),
  voided_at      timestamptz,
  voided_by      uuid references employees(id),
  void_reason    text,
  voids_document uuid references documents(id),   -- set on the reversing doc
  created_by     uuid references employees(id),
  created_at     timestamptz not null default now(),

  constraint issue_reason_known check (
    issue_reason is null or
    issue_reason in ('sale','internal','sample','damage','writeoff')
  ),

  -- An adjustment is the only document type that creates stock from nothing
  -- (§10.7). It never posts without a stated reason.
  constraint adjustment_requires_reason check (
    doc_type <> 'ADJUSTMENT' or status <> 'POSTED' or
    (reason is not null and length(trim(reason)) > 0)
  ),

  -- A transfer needs both ends, and they must differ.
  constraint transfer_has_destination check (
    doc_type <> 'TRANSFER' or
    (to_location_id is not null and to_location_id <> location_id)
  ),
  constraint destination_only_on_transfer check (
    doc_type = 'TRANSFER' or to_location_id is null
  ),

  -- Everything except a transfer's destination needs a source location.
  constraint posted_needs_location check (
    status <> 'POSTED' or location_id is not null
  ),

  constraint void_has_reason check (
    status <> 'VOIDED' or (void_reason is not null and length(trim(void_reason)) > 0)
  ),

  -- Posting stamps both fields together, or neither.
  constraint posted_stamps_complete check (
    (status = 'POSTED') = (posted_at is not null and posted_by is not null)
    or status = 'VOIDED'
  )
);

create index on documents (doc_type, occurred_at desc);
create index on documents (status, occurred_at desc);
create index on documents (location_id, occurred_at desc);
create index on documents (supplier_id) where supplier_id is not null;
create index on documents (posted_by, posted_at desc);
create index on documents (created_by, created_at desc);
-- Drafts left unposted over 48 hours are a data-health signal (§7.10).
create index on documents (created_at) where status = 'DRAFT';

create table document_lines (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references documents(id) on delete cascade,
  item_id        uuid not null references items(id),
  quantity       numeric(12,3) not null,
  unit_cost      numeric(12,2),
  sell_price     numeric(12,2),
  counted_qty    numeric(12,3),      -- COUNT only
  expected_qty   numeric(12,3),      -- COUNT only, snapshot at count time
  serial_unit_id uuid,               -- serialized items only; FK added in 0006
  note           text,

  -- ADJUSTMENT only. Quantity stays positive on every line so the entry
  -- screens never ask anyone to type a minus sign; direction is an explicit
  -- choice instead. Shrinkage (§5.9) is counted from decrease adjustments,
  -- so this column is what makes that metric possible at all.
  direction      text,

  -- Quantities are always entered positive; direction comes from doc_type at
  -- posting time. Letting a receipt carry a negative quantity would make
  -- "receipt" and "issue" indistinguishable in the ledger.
  constraint line_quantity_positive check (quantity > 0),
  constraint line_cost_non_negative check (unit_cost is null or unit_cost >= 0),
  constraint line_direction_known check (
    direction is null or direction in ('increase','decrease')
  )
);

create index on document_lines (document_id);
create index on document_lines (item_id);

-- ON DELETE CASCADE above exists for drafts only. A posted document is never
-- deleted, so the cascade can never destroy history.


-- ---------------------------------------------------------------------------
-- Document numbering
-- ---------------------------------------------------------------------------

create sequence doc_number_receipt    start 1;
create sequence doc_number_issue      start 1;
create sequence doc_number_adjustment start 1;
create sequence doc_number_count      start 1;
create sequence doc_number_transfer   start 1;

-- Human-facing identifiers, spoken aloud and written on paper. Sequences are
-- used rather than a count query so concurrent creation cannot collide.
-- Sequences skip numbers on rollback, which is correct here: a gap means a
-- draft was abandoned, and inventing a number to fill it would be worse.
create or replace function next_doc_number(p_type doc_type)
returns text language plpgsql as $$
declare
  v_prefix text;
  v_seq    text;
  v_n      bigint;
begin
  case p_type
    when 'RECEIPT'    then v_prefix := 'RCP'; v_seq := 'doc_number_receipt';
    when 'ISSUE'      then v_prefix := 'ISS'; v_seq := 'doc_number_issue';
    when 'ADJUSTMENT' then v_prefix := 'ADJ'; v_seq := 'doc_number_adjustment';
    when 'COUNT'      then v_prefix := 'CNT'; v_seq := 'doc_number_count';
    when 'TRANSFER'   then v_prefix := 'TRF'; v_seq := 'doc_number_transfer';
  end case;

  v_n := nextval(v_seq);
  return v_prefix || '-' || lpad(v_n::text, 6, '0');
end; $$;

grant execute on function next_doc_number(doc_type) to authenticated;

create or replace function set_doc_number()
returns trigger language plpgsql as $$
begin
  if new.doc_number is null then
    new.doc_number := next_doc_number(new.doc_type);
  end if;
  return new;
end; $$;

create trigger documents_set_number
  before insert on documents
  for each row execute function set_doc_number();


-- ---------------------------------------------------------------------------
-- Posted documents are immutable (§4.2)
-- ---------------------------------------------------------------------------

create or replace function block_posted_document_edit()
returns trigger language plpgsql as $$
begin
  if old.status = 'POSTED' then
    -- The void path is the one permitted transition, and it only sets the
    -- void columns.
    if new.status = 'VOIDED'
       and new.doc_type    is not distinct from old.doc_type
       and new.location_id is not distinct from old.location_id
       and new.occurred_at is not distinct from old.occurred_at
       and new.posted_at   is not distinct from old.posted_at
       and new.posted_by   is not distinct from old.posted_by then
      return new;
    end if;

    raise exception
      'document % is posted and cannot be edited — void it and re-enter instead',
      old.doc_number
      using errcode = 'check_violation';
  end if;

  if old.status = 'VOIDED' then
    raise exception 'document % is voided and cannot be edited', old.doc_number
      using errcode = 'check_violation';
  end if;

  return new;
end; $$;

create trigger documents_block_posted_edit
  before update on documents
  for each row execute function block_posted_document_edit();

create or replace function block_posted_line_edit()
returns trigger language plpgsql as $$
declare
  v_status doc_status;
  v_number text;
begin
  select status, doc_number into v_status, v_number
  from documents
  where id = coalesce(new.document_id, old.document_id);

  if v_status <> 'DRAFT' then
    raise exception
      'document % is %, its lines cannot be changed', v_number, lower(v_status::text)
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end; $$;

create trigger document_lines_block_posted_edit
  before insert or update or delete on document_lines
  for each row execute function block_posted_line_edit();


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table documents      enable row level security;
alter table document_lines enable row level security;

create policy documents_read on documents for select using (is_active_employee());
create policy lines_read     on document_lines for select using (is_active_employee());

-- Buyers create and edit drafts; the posting function enforces the per-type
-- role rules (adjustments and counts need manager).
create policy documents_write on documents for all
  using (has_role('buyer')) with check (has_role('buyer'));
create policy lines_write on document_lines for all
  using (has_role('buyer')) with check (has_role('buyer'));

revoke delete on documents from anon, authenticated;
