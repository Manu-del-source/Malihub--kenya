# Order Lifecycle

The authoritative definition of how a MaliHub order moves. The rules live in
code — [`src/lib/order-state-machine.ts`](../src/lib/order-state-machine.ts) —
and the only code that writes `Order.status` lives in
[`src/services/order-transition-service.ts`](../src/services/order-transition-service.ts).

This document explains *why* the lifecycle is shaped the way it is. It is not a
substitute for either file.

---

## The lifecycle

```
  PENDING ──(payment confirmed — Phase 9.2)──▶ PAID
     │                                           │
     │                                           ▼
     │                                        SHIPPED
     │                                           │
     │                                           ▼
     │                                        DELIVERED
     │                                           │
     │                                           ▼
     │                                       COMPLETED  (terminal)
     │
     └──(buyer cancels their own unpaid order)──▶ CANCELLED  (terminal)
```

### Allowed transitions

| From | To | Who may do it | When it lands |
|---|---|---|---|
| `PENDING` | `PAID` | verified payment confirmation only | Phase 9.2 |
| `PENDING` | `CANCELLED` | the buyer who owns the order | Phase 9.1 ✅ |
| `PAID` | `SHIPPED` | the seller who owns the order | service only |
| `SHIPPED` | `DELIVERED` | the seller who owns the order | service only |
| `DELIVERED` | `COMPLETED` | the buyer who owns the order | service only |

Everything else is refused, including every move out of `CANCELLED`,
`COMPLETED` and `REFUNDED`. The table is an **allowlist**: a status added to
the Prisma enum later is unreachable by default rather than wide open.

### `REFUNDED` is closed on purpose

`REFUNDED` is terminal and has no inbound transition. It is a *financial*
event — money has to actually come back through a payment provider — and a
`RefundService` in a later phase will own the only path into it. An
application-level flag that could mark an order `REFUNDED` while the money was
still with the provider would be worse than having no such flag at all.

### `CONFIRMED` is a reserved legacy value

The Prisma enum contains a `CONFIRMED` value that **no code in this repository
ever writes, branches on, or gives a meaning**. It survives in three places: the
enum itself, an admin filter dropdown, and a display label.

It is also semantically redundant. `PENDING` is labelled "Awaiting payment"
and `CONFIRMED` is not treated as paid, so `CONFIRMED` would either mean the
same thing as `PENDING` (order placed) or the same thing as `PAID` (payment
received).

So Phase 9.1:

- **keeps** the value — removing an enum value is a destructive migration, and
  it is out of scope;
- **never transitions into or out of** it;
- **keeps it renderable**, so a legacy row that somehow carries it still shows
  a sensible label.

If a future phase needs a genuine "seller has accepted this order" step, it
should add a clearly-named new value with a real state machine entry — not
quietly revive `CONFIRMED`.

---

## Cancellation and inventory

Checkout reserves stock: `checkoutCart` decrements `Product.quantity` for every
line inside the same transaction that creates the order. Cancellation gives
those units back.

**The units are released from `OrderItem.quantity`** — the database's own record
of what was reserved at checkout. The cancellation request carries no
quantities, so a caller cannot ask for a different number back.

### The invariant

A successful cancellation means **both**:

1. `Order.status = CANCELLED`, and
2. inventory restored — exactly once.

A failed cancellation means **neither**. These cannot diverge, because both
halves happen inside one database transaction: if the inventory step throws, the
status change rolls back with it. The unreachable bad states are
`CANCELLED` + unrestocked, and restocked + still `PENDING`.

### Why concurrent cancellation is safe

Two simultaneous cancellation requests must not release the same units twice.
The mechanism is a **conditional claim**, the same shape `checkoutCart` uses for
the cart:

1. read the order inside the transaction,
2. validate the move with the pure state machine,
3. `updateMany({ where: { id, status: <status just read> }, data: { status: "CANCELLED" } })`,
4. if `count !== 1`, abort **before** touching any inventory.

The `where: { status }` clause is load-bearing. A plain
`order.update({ where: { id }, data: { status } })` would be read-then-write:
both requests would read `PENDING`, both would validate, and both would restore.
With the conditional update, the second writer's predicate no longer matches, it
gets `count === 0`, and it aborts having written nothing.

The same mechanism means a cancellation racing a payment confirmation has
exactly one winner: whoever claims the row first, and the loser observes the
changed state and performs no side effects.

### Moderated listings

Inventory is restored even if the listing was suspended or removed while the
order was open. The units were reserved while the listing was `ACTIVE`, so they
belong to the seller regardless of what happened to the listing afterwards.
Losing them would turn a moderation decision into silent inventory loss. Only
`quantity` is written; `status` and every other listing field are untouched.

---

## Authorization

| Transition | Authorized actor |
|---|---|
| cancel | the buyer who owns the order — **only** |
| mark paid | a verified payment confirmation (Phase 9.2); no route exposes it |
| ship / deliver | the seller who owns the order |
| complete | the buyer who owns the order |

Identity always comes from the server-resolved session. No transition accepts a
user id, role, seller id or target status from a request body.

**Admins have no order-transition authority in Phase 9.1.** `ADMIN` and
`SUPER_ADMIN` are functionally identical in this codebase today, and granting
either a blanket ability to move orders would hand every staff account a way to
alter a financial record. That is a permissions decision for a later phase, not
something to smuggle in with a state machine.

A seller cannot cancel a buyer's order by knowing its UUID, and one seller
cannot cancel another's. An order that does not exist and an order belonging to
someone else are reported **identically** (`not_found`), so this endpoint
cannot be used to discover other buyers' order ids.

---

## Audit and notifications

Every accepted transition writes one `audit_logs` row through the existing
`logAuditEvent`, recording the actor, the target order, and the `from → to`
pair. A cancellation additionally records the number of units released. No
credentials, contact details, or payment data are ever written — the trail
answers "what changed and who changed it", which is all it should answer.

Notifications go to the buyer and the seller after the transaction commits, via
the existing `notifyUser`. **They cannot affect the outcome:** a notification or
audit failure is swallowed, because the database transaction is authoritative
and has already committed correctly.

---

## What Phase 9.1 deliberately does not do

- **No payment collection.** `PENDING → PAID` exists as a service primitive
  with a defined interface, and nothing calls it yet. PayHero integration,
  webhook handling and the `Payment` record are **Phase 9.2**.
- **No `Payment` rows.** Checkout still means cart → `Order(PENDING)`. A
  payment is a separate financial event, and fabricating a `Payment` row to
  make this phase look complete would put a lie in the one table the whole
  financial system is reconciled against.
- **No refunds.** `REFUNDED` has no inbound transition (§ above).
- **No settlements or payouts.** Those belong to later phases; a settlement is
  a *paid* order's concern and this phase only reaches `PENDING`.
- **No fulfilment UI.** `PAID → SHIPPED → DELIVERED → COMPLETED` is implemented
  and tested at the service layer, but the seller order screens have no
  fulfilment controls to attach it to yet.
- **No schema change.** Every model, index and constraint Phase 9.1 needs
  already exists in `prisma/schema.prisma`. The compare-and-swap relies on
  `orders.status` being filterable, which the existing `@@index([status])`
  already provides.
