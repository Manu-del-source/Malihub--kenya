-- Phase 6: RLS for chat, orders, and reviews, plus Realtime enablement.
-- Same caveat as manual_rls_policies.sql: Prisma's app queries bypass RLS
-- (privileged connection) — these policies matter for direct Supabase
-- client access, which Phase 6's chat UI uses for Realtime subscriptions.
-- Run once against Supabase Postgres (SQL editor or `supabase db push`).

-- ─── chats ──────────────────────────────────────────────────────────────
alter table public.chats enable row level security;

create policy "chats_select_participant"
  on public.chats for select
  using (auth.uid() = buyer_id or auth.uid() = seller_id or public.is_admin());

create policy "chats_insert_as_buyer"
  on public.chats for insert
  with check (auth.uid() = buyer_id);

create policy "chats_update_participant"
  on public.chats for update
  using (auth.uid() = buyer_id or auth.uid() = seller_id)
  with check (auth.uid() = buyer_id or auth.uid() = seller_id);

-- ─── messages ───────────────────────────────────────────────────────────
alter table public.messages enable row level security;

create policy "messages_select_participant"
  on public.messages for select
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (auth.uid() = c.buyer_id or auth.uid() = c.seller_id)
    )
    or public.is_admin()
  );

create policy "messages_insert_participant"
  on public.messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (auth.uid() = c.buyer_id or auth.uid() = c.seller_id)
    )
  );

create policy "messages_update_mark_read"
  on public.messages for update
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (auth.uid() = c.buyer_id or auth.uid() = c.seller_id)
    )
  )
  with check (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (auth.uid() = c.buyer_id or auth.uid() = c.seller_id)
    )
  );

-- Realtime: broadcast row changes on these two tables so the chat UI can
-- subscribe via postgres_changes without polling.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.chats;

-- ─── orders / order_items / payments ─────────────────────────────────────
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

create policy "orders_select_participant"
  on public.orders for select
  using (
    auth.uid() = buyer_id
    or exists (select 1 from public.sellers s where s.id = orders.seller_id and s.user_id = auth.uid())
    or public.is_admin()
  );

create policy "order_items_select_participant"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          auth.uid() = o.buyer_id
          or exists (select 1 from public.sellers s where s.id = o.seller_id and s.user_id = auth.uid())
        )
    )
    or public.is_admin()
  );

create policy "payments_select_participant"
  on public.payments for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and (
          auth.uid() = o.buyer_id
          or exists (select 1 from public.sellers s where s.id = o.seller_id and s.user_id = auth.uid())
        )
    )
    or public.is_admin()
  );

-- All order/payment *writes* go through Prisma Server Actions (checkout,
-- M-Pesa callback) using the privileged connection — no insert/update
-- policies needed here since the anon/authenticated roles never write
-- these tables directly.

-- ─── order_reviews ─────────────────────────────────────────────────────
alter table public.order_reviews enable row level security;

create policy "order_reviews_select_public"
  on public.order_reviews for select
  using (true); -- reviews are public once posted, like any marketplace review

create policy "order_reviews_insert_participant"
  on public.order_reviews for insert
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.orders o
      where o.id = order_reviews.order_id
        and o.status = 'COMPLETED'
        and (
          auth.uid() = o.buyer_id
          or exists (select 1 from public.sellers s where s.id = o.seller_id and s.user_id = auth.uid())
        )
    )
  );

-- ─── blocked_users ─────────────────────────────────────────────────────
alter table public.blocked_users enable row level security;

-- A user can see who THEY blocked, not who blocked them (mirrors the
-- "invisible block" behavior described on the BlockedUser model).
create policy "blocked_users_select_own"
  on public.blocked_users for select
  using (auth.uid() = blocker_id or public.is_admin());

create policy "blocked_users_insert_own"
  on public.blocked_users for insert
  with check (auth.uid() = blocker_id);

create policy "blocked_users_delete_own"
  on public.blocked_users for delete
  using (auth.uid() = blocker_id);
