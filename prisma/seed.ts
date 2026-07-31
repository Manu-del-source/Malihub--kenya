/**
 * Seeds reference data only (categories). Products/orders/etc. are real
 * user-generated data and are never seeded — a fresh deploy legitimately
 * starts with zero listings until sellers create them.
 *
 * Run with: npm run prisma:seed
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_CATEGORIES } from "../src/lib/constants";

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${DEFAULT_CATEGORIES.length} categories…`);

  for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        iconName: category.iconName,
        sortOrder: index,
      },
      create: {
        name: category.name,
        slug: category.slug,
        iconName: category.iconName,
        sortOrder: index,
      },
    });
  }

  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
