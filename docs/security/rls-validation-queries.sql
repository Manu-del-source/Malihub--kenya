-- MaliHub RLS validation queries. READ ONLY: run against the isolated
-- Neon branch, never against production during implementation.
-- These queries report state; they do not prove that every application path
-- is safe. Run using a non-owner role as well as a metadata-capable audit role.

-- 1. RLS enabled/forced state for public tables.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- 2. Policy coverage and supported commands by table.
SELECT tablename,
       count(*) AS policy_count,
       string_agg(DISTINCT cmd, ', ' ORDER BY cmd) AS policy_commands,
       string_agg(DISTINCT roles::text, ', ' ORDER BY roles::text) AS policy_roles
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- 3. Roles that can bypass RLS or are superusers. Never use such a role to
-- claim that RLS has been validated.
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('neondb_owner', 'malihub_rls_test', 'malihub_rls_probe')
ORDER BY rolname;

-- 4. Public tables with RLS enabled but no policy.
SELECT n.nspname AS schema_name, c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relrowsecurity
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = n.nspname AND p.tablename = c.relname
  )
ORDER BY c.relname;

-- 5. Tables that have RLS disabled. Review each table against the data
-- classification and runtime-access inventory; some infrastructure tables
-- (for example, migration metadata) may intentionally remain outside RLS.
SELECT n.nspname AS schema_name, c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND NOT c.relrowsecurity
ORDER BY c.relname;

-- 6. Policies that are permissive or use broad expressions need manual review.
-- Do not assume a policy is safe merely because it exists.
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
