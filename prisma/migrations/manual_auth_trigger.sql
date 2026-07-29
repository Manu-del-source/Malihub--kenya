-- Mirrors Supabase's auth.users into public.users + public.profiles so
-- Prisma's app-data models always have a matching row to attach to.
-- Run this once against your Supabase Postgres instance (SQL editor, or
-- `supabase db push` if you've adopted the Supabase CLI migration flow).
--
-- Why a trigger and not app code: signups can also happen via Google OAuth,
-- where Supabase creates the auth.users row directly — there's no Server
-- Action in the request path to do this insert from app code. The trigger
-- guarantees the mirror row exists no matter which path created the user.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, phone, email_verified, created_at, updated_at)
  values (
    new.id,
    new.email,
    new.phone,
    (new.email_confirmed_at is not null),
    now(),
    now()
  )
  on conflict (id) do nothing;

  -- Seed an empty, not-yet-onboarded profile. full_name falls back to
  -- whatever the OAuth provider supplied (Google puts it in user_metadata),
  -- or an empty string for email/password signups — complete-profile fills
  -- it in properly either way.
  insert into public.profiles (id, user_id, full_name, avatar_url, onboarded, created_at, updated_at)
  values (
    gen_random_uuid(),
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url',
    false,
    now(),
    now()
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Keeps public.users.email_verified in sync when a user confirms their
-- email after the row already exists (the common case: insert happens
-- immediately at signup, confirmation happens minutes later when they
-- click the email link).
create or replace function public.handle_auth_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.users
    set email_verified = true, updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update on auth.users
  for each row execute function public.handle_auth_user_confirmed();
