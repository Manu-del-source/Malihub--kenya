-- Phase 7: RLS for audit_logs.
-- Run once against Supabase Postgres (SQL editor or `supabase db push`).

alter table public.audit_logs enable row level security;

-- Audit logs contain IPs, emails, and action metadata — admin-only, never
-- visible to the user they're about. There's no insert/update policy
-- because every write goes through services/audit-service.ts on Prisma's
-- privileged connection; the anon/authenticated roles never write this
-- table directly.
create policy "audit_logs_select_admin_only"
  on public.audit_logs for select
  using (public.is_admin());
