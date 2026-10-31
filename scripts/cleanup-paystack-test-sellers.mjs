#!/usr/bin/env node
/**
 * Remove the two explicitly identified Paystack test seller accounts and
 * their test-only marketplace/authentication records.
 *
 * Safe by default: without --execute this script only prints a preflight
 * report. Execution additionally requires:
 *   MALIHUB_ALLOW_TEST_SELLER_CLEANUP=true
 *   MALIHUB_CLEANUP_CONFIRMATION=DELETE_THE_TWO_PAYSTACK_TEST_SELLERS
 *   DIRECT_URL pointing at the intended production Neon database.
 *
 * Run from the repository root:
 *   node scripts/cleanup-paystack-test-sellers.mjs
 *   MALIHUB_ALLOW_TEST_SELLER_CLEANUP=true \
 *   MALIHUB_CLEANUP_CONFIRMATION=DELETE_THE_TWO_PAYSTACK_TEST_SELLERS \
 *   node scripts/cleanup-paystack-test-sellers.mjs --execute
 *
 * This does not delete Paystack's own records, Cloudinary assets, or Neon
 * backup branches. Check applicable accounting/legal retention obligations.
 */
import { PrismaClient } from "@prisma/client";

const EXPECTED_DATABASE = "neondb";
const CONFIRMATION = "DELETE_THE_TWO_PAYSTACK_TEST_SELLERS";
const execute = process.argv.includes("--execute");

const sellers = [
  "0d8d7f00-b445-4bfa-99f9-077e2021adc2",
  "b526c248-5466-466b-9a58-364d5f779bf7",
];
const appUsers = [
  "6601c05a-3848-49a4-8f10-22c539d7aaae",
  "f5ec33e4-d896-4142-a6c9-d50c07766097",
];
const authUsers = [
  "86bc29ce-f822-482a-9ab3-f96c179fc57c",
  "464d48fa-7865-4a1f-9d96-bd778c3b1e60",
];
const emails = ["damianemmanuel449@gmail.com", "fatmanscoop987@gmail.com"];

if (!process.env.DIRECT_URL?.trim()) {
  console.error("Refusing to run: DIRECT_URL (unpooled database URL) is required.");
  process.exit(1);
}
if (execute && process.env.MALIHUB_ALLOW_TEST_SELLER_CLEANUP !== "true") {
  console.error("Refusing to execute: set MALIHUB_ALLOW_TEST_SELLER_CLEANUP=true explicitly.");
  process.exit(1);
}
if (execute && process.env.MALIHUB_CLEANUP_CONFIRMATION !== CONFIRMATION) {
  console.error("Refusing to execute: exact cleanup confirmation token is missing.");
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

const q = async (client, sql) => client.$queryRawUnsafe(sql);
const count = async (client, label, sql) => {
  const rows = await q(client, sql);
  return { label, count: Number(rows[0]?.count ?? 0) };
};

const idList = (values) => values.map((value) => `'${value}'`).join(", ");
const sellerList = idList(sellers);
const appUserList = idList(appUsers);
const authUserList = idList(authUsers);
const emailList = emails.map((value) => `'${value}'`).join(", ");

const scope = [
  ["Database", "SELECT current_database() AS value"],
  ["Application users", `SELECT count(*) FROM public.users WHERE id IN (${appUserList}) AND lower(email) IN (${emailList})`],
  ["Seller profiles", `SELECT count(*) FROM public.sellers WHERE id IN (${sellerList}) AND user_id IN (${appUserList})`],
  ["Test seller orders", `SELECT count(*) FROM public.orders WHERE seller_id IN (${sellerList})`],
  ["Test seller products", `SELECT count(*) FROM public.products WHERE seller_id IN (${sellerList})`],
  ["Order items", `SELECT count(*) FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE seller_id IN (${sellerList}))`],
  ["Payment rows", `SELECT count(*) FROM public.payments WHERE order_id IN (SELECT id FROM public.orders WHERE seller_id IN (${sellerList}))`],
  ["Linked payment events", `SELECT count(*) FROM public.payment_events WHERE payment_id IN (SELECT id FROM public.payments WHERE order_id IN (SELECT id FROM public.orders WHERE seller_id IN (${sellerList})))`],
  ["Neon Auth users", `SELECT count(*) FROM neon_auth."user" WHERE id IN (${authUserList}) AND lower(email) IN (${emailList})`],
  ["Neon Auth accounts", `SELECT count(*) FROM neon_auth.account WHERE "userId" IN (${authUserList})`],
  ["Neon Auth sessions", `SELECT count(*) FROM neon_auth.session WHERE "userId" IN (${authUserList})`],
  ["Audit log rows", `SELECT count(*) FROM public.audit_logs WHERE target_id IN (${appUsers.concat(sellers).map((id) => `'${id}'`).join(", ")}) OR lower(actor_email) IN (${emailList}) OR actor_id IN (${authUserList})`],
];

const blockers = [
  ["orders bought by these accounts", `SELECT count(*) FROM public.orders WHERE buyer_id IN (${appUserList})`],
  ["refunds for target orders", `SELECT count(*) FROM public.refunds WHERE order_id IN (SELECT id FROM public.orders WHERE seller_id IN (${sellerList}))`],
  ["refunds initiated by target users", `SELECT count(*) FROM public.refunds WHERE initiated_by_user_id IN (${appUserList})`],
  ["settlements for target orders/sellers", `SELECT count(*) FROM public.settlements WHERE order_id IN (SELECT id FROM public.orders WHERE seller_id IN (${sellerList})) OR seller_id IN (${sellerList})`],
  ["payouts for target sellers", `SELECT count(*) FROM public.payouts WHERE seller_id IN (${sellerList})`],
  ["seller payout accounts", `SELECT count(*) FROM public.seller_payout_accounts WHERE seller_id IN (${sellerList})`],
  ["supplier purchases for target orders/sellers", `SELECT count(*) FROM public.supplier_purchases WHERE order_id IN (SELECT id FROM public.orders WHERE seller_id IN (${sellerList})) OR seller_id IN (${sellerList})`],
  ["supplier returns for target orders/buyers", `SELECT count(*) FROM public.supplier_return_requests WHERE order_id IN (SELECT id FROM public.orders WHERE seller_id IN (${sellerList})) OR buyer_id IN (${appUserList})`],
  ["supplier fulfilments for target sellers/buyers/products", `SELECT count(*) FROM public.supplier_fulfilments WHERE seller_id IN (${sellerList}) OR buyer_id IN (${appUserList}) OR product_id IN (SELECT id FROM public.products WHERE seller_id IN (${sellerList}))`],
  ["buyer protection cases", `SELECT count(*) FROM public.buyer_protection_cases WHERE buyer_id IN (${appUserList}) OR order_id IN (SELECT id FROM public.orders WHERE seller_id IN (${sellerList}))`],
  ["buyer protection evidence", `SELECT count(*) FROM public.buyer_protection_evidence WHERE submitted_by IN (${appUserList})`],
  ["campaigns created by target users", `SELECT count(*) FROM public.campaigns WHERE created_by_id IN (${appUserList})`],
  ["support tickets", `SELECT count(*) FROM public.support_tickets WHERE user_id IN (${appUserList})`],
  ["Neon Auth organization memberships", `SELECT count(*) FROM neon_auth.member WHERE "userId" IN (${authUserList})`],
];

async function inspect(client, { allowAbsent = false } = {}) {
  const database = await q(client, scope[0][1]);
  const dbName = database[0]?.value;
  if (dbName !== EXPECTED_DATABASE) {
    throw new Error(`Wrong database: expected ${EXPECTED_DATABASE}, connected to ${dbName}.`);
  }

  const results = [];
  for (const [label, sql] of scope.slice(1)) results.push(await count(client, label, sql));
  const blocked = [];
  for (const [label, sql] of blockers) {
    const result = await count(client, label, sql);
    if (result.count !== 0) blocked.push(result);
  }

  const expectedIdentityCount = allowAbsent ? 0 : 2;
  for (const label of ["Application users", "Seller profiles", "Neon Auth users"]) {
    if (results.find((item) => item.label === label)?.count !== expectedIdentityCount) {
      throw new Error(`Identity guard failed: expected ${expectedIdentityCount} ${label.toLowerCase()} after ${allowAbsent ? "cleanup" : "preflight"}.`);
    }
  }
  if (blocked.length) {
    throw new Error("Safety stop: unexpected dependent financial, buyer, supplier, support, or organization records exist:\n" +
      blocked.map((item) => `- ${item.label}: ${item.count}`).join("\n"));
  }
  return results;
}

async function remove(client) {
  // Capture event ids before deleting orders; the FK on payment_events is SET NULL.
  await client.$executeRawUnsafe(`
    DELETE FROM public.payment_events
    WHERE payment_id IN (
      SELECT p.id FROM public.payments p
      JOIN public.orders o ON o.id = p.order_id
      WHERE o.seller_id IN (${sellerList})
    )
  `);

  // Remove only audit entries whose actor/email/target identifies these test accounts.
  await client.$executeRawUnsafe(`
    DELETE FROM public.audit_logs
    WHERE target_id IN (${appUsers.concat(sellers).map((id) => `'${id}'`).join(", ")})
       OR lower(actor_email) IN (${emailList})
       OR actor_id IN (${authUserList})
  `);

  // Order deletion cascades to order_items, payments, shipment/review and other
  // order-owned rows. The preflight blocks all known restrictive financial links.
  await client.$executeRawUnsafe(`
    DELETE FROM public.orders WHERE seller_id IN (${sellerList})
  `);

  // Product deletion cascades to images, views, cart rows, reports, reviews,
  // wishlists and campaign-product joins. Restrictive supplier/order links were
  // checked above and must remain zero.
  await client.$executeRawUnsafe(`
    DELETE FROM public.products WHERE seller_id IN (${sellerList})
  `);

  await client.$executeRawUnsafe(`
    DELETE FROM public.sellers WHERE id IN (${sellerList})
  `);
  await client.$executeRawUnsafe(`
    DELETE FROM public.users WHERE id IN (${appUserList})
  `);

  // Neon Auth owns credentials and sessions in its separate schema.
  // Deleting the auth user cascades to its account and session rows.
  await client.$executeRawUnsafe(`
    DELETE FROM neon_auth."user"
    WHERE id IN (${authUserList}) AND lower(email) IN (${emailList})
  `);
  await client.$executeRawUnsafe(`
    DELETE FROM neon_auth.verification WHERE lower(identifier) IN (${emailList})
  `);
}

try {
  const report = await inspect(prisma);
  console.log(`Connected to ${EXPECTED_DATABASE}. Cleanup preflight:`);
  for (const item of report) console.log(`- ${item.label}: ${item.count}`);

  if (!execute) {
    console.log("\nDRY RUN ONLY — no rows were changed.");
    console.log("To execute, use --execute plus both explicit environment confirmations documented at the top of this file.");
    process.exitCode = 0;
  } else {
    const deleted = await prisma.$transaction(async (tx) => {
      // Re-run all guards inside the same transaction immediately before writes.
      const current = await inspect(tx);
      await remove(tx);
      return current;
    }, { maxWait: 10_000, timeout: 60_000 });

    console.log("\nCleanup transaction committed. Pre-delete counts:");
    for (const item of deleted) console.log(`- ${item.label}: ${item.count}`);

    const remaining = await inspect(prisma, { allowAbsent: true });
    const nonZero = remaining.filter((item) => item.count !== 0);
    if (nonZero.length) {
      console.error("Post-cleanup verification failed:", nonZero);
      process.exitCode = 2;
    } else {
      console.log("Post-cleanup verification passed: all scoped application, seller, order, payment, auth and audit rows are absent.");
    }
  }
} catch (error) {
  console.error("Cleanup stopped; transaction was not committed if a guard failed:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
