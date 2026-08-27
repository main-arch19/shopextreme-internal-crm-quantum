-- 0000_extensions.sql
-- pgcrypto supplies gen_random_uuid() for primary keys and digest() for the
-- audit-log hash chain (§10.4). Both are required before any later migration.

create extension if not exists pgcrypto with schema extensions;

-- digest() lives in the extensions schema. Put it on the search_path for the
-- security-definer functions that call it, so write_audit() does not have to
-- schema-qualify every call.
grant usage on schema extensions to authenticated, service_role;
