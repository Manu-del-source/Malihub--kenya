/**
 * Remove ALL MaliHub demo data created by prisma/seed-demo.ts.
 *
 * Run with: npm run prisma:seed:demo:wipe
 * Or from GitHub Actions: run the "Seed Demo Listings (Production)" workflow
 * with the `wipe_demo` input set to true.
 *
 * What it deletes (and ONLY this):
 *  - the 12 demo listings (products whose slug starts with "seed-"), plus
 *    their image rows and any cascaded favourites/reviews/carts/views
 *    attached to them;
 *  - the 3 demo sellers (slug suffix is matched by their seed- email
 *    domains below, and by the exact demo slugs);
 *  - the 3 demo seller users (seed-*@malihubke.online), which cascades
 *    their profiles and seller rows.
 *
 * What it does NOT touch:
 *  - categories (shared by real sellers too; they are also what the real
 *    seed script creates);
 *  - any real user, seller, or listing. Matching is deliberately narrow:
 *    a product must have a "seed-" slug prefix, a seller must be one of the
 *    three demo slugs, and a user must have a seed- email at
 *    malihubke.online. Nothing else can match.
 *
 * Safety: if any demo-owned row is blocked by a Restrict relation (for
 * example a demo listing already has an order placed against it), the
 * delete fails loudly instead of forcing it. Clear those rows deliberately
 * first, then re-run.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_SLUG_PREFIX = "seed-";
const DEMO_SELLER_SLUGS = [
  "nairobi-tech-deals",
  "mombasa-home-craft",
  "wanjiru-fashion-store",
];
const DEMO_EMAIL_DOMAIN = "@malihubke.online";

async function main() {
  console.log(`Deleting demo listings (slug starts with "${DEMO_SLUG_PREFIX}")…`);
  const products = await prisma.product.deleteMany({
    where: { slug: { startsWith: DEMO_SLUG_PREFIX } },
  });
  console.log(`  deleted ${products.count} demo listings (and their images)`);

  console.log("Deleting demo sellers…");
  const sellers = await prisma.seller.deleteMany({
    where: { slug: { in: DEMO_SELLER_SLUGS } },
  });
  console.log(`  deleted ${sellers.count} demo sellers`);

  console.log("Deleting demo seller users (cascades profiles)…");
  const users = await prisma.user.deleteMany({
    where: {
      email: { startsWith: "seed-", endsWith: DEMO_EMAIL_DOMAIN },
    },
  });
  console.log(`  deleted ${users.count} demo seller users`);

  console.log("Done. Categories were left untouched.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
