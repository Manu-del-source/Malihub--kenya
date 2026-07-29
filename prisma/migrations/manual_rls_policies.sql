-- Row Level Security for user-owned tables.
--
-- IMPORTANT CAVEAT (see ARCHITECTURE.md §5 and §11): the app's primary data
-- path is Prisma, connected via DATABASE_URL as a privileged Postgres role
-- that BYPASSES RLS entirely. These policies are NOT what protects Server
-- Action mutations — that's the explicit `ownerId === session.user.id`
-- check in each Server Action. RLS here is the backstop for anything that
-- reaches Postgres a different way: direct Supabase client calls (Storage,
-- future Realtime subscriptions on notifications/chat), and defense-in-depth
-- if a table is ever queried straight from the browser with the anon key.
--
-- Run once against Supabase Postgres (SQL editor or `supabase db push`).

-- Helper: reads the role we already mirror into the JWT's app_metadata
-- (see src/app/(auth)/actions.ts — role is set via the Supabase Admin API
-- on signup/profile completion). Avoids a recursive table lookup inside
-- a users-table policy.
create or replace function public.jwt_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'BUYER');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.jwt_role() in ('ADMIN', 'SUPER_ADMIN');
$$;

-- ─── users ──────────────────────────────────────────────────────────────
alter table public.users enable row level security;

create policy "users_select_own_or_admin"
  on public.users for select
  using (auth.uid() = id or public.is_admin());

create policy "users_update_own"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ─── profiles ───────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = user_id or public.is_admin());

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── sellers ────────────────────────────────────────────────────────────
alter table public.sellers enable row level security;

-- Verified sellers are public storefronts — readable by anyone (needed for
-- Phase 5 product/seller pages). Unverified sellers are only visible to
-- themselves and admins (avoids exposing pending applications).
create policy "sellers_select_verified_public"
  on public.sellers for select
  using (verification_status = 'VERIFIED' or auth.uid() = user_id or public.is_admin());

create policy "sellers_insert_own"
  on public.sellers for insert
  with check (auth.uid() = user_id);

create policy "sellers_update_own_or_admin"
  on public.sellers for update
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

-- ─── wishlists / cart_items / saved_searches / notifications ────────────
-- All four are strictly private, single-owner tables — same shape of policy.
do $$
declare
  t text;
begin
  foreach t in array array['wishlists', 'cart_items', 'saved_searches', 'notifications']
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format(
      'create policy "%1$s_select_own" on public.%1$s for select using (auth.uid() = user_id);',
      t
    );
    execute format(
      'create policy "%1$s_insert_own" on public.%1$s for insert with check (auth.uid() = user_id);',
      t
    );
    execute format(
      'create policy "%1$s_update_own" on public.%1$s for update using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t
    );
    execute format(
      'create policy "%1$s_delete_own" on public.%1$s for delete using (auth.uid() = user_id);',
      t
    );
  end loop;
end $$;
