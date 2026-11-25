/**
 * Seeds reference data only (categories). Products/orders/etc. are real
 * user-generated data and are never seeded — a fresh deploy legitimately
 * starts with zero listings until sellers create them.
 *
 * Run with: npm run prisma:seed
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_CHILDREN } from "../src/lib/constants";

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

  for (const [index, child] of DEFAULT_CATEGORY_CHILDREN.entries()) {
    const parent = await prisma.category.findUnique({
      where: { slug: child.parentSlug },
      select: { id: true },
    });
    if (!parent) {
      throw new Error(`Missing parent category "${child.parentSlug}" for "${child.slug}".`);
    }

    await prisma.category.upsert({
      where: { slug: child.slug },
      update: {
        name: child.name,
        parentId: parent.id,
        sortOrder: index,
      },
      create: {
        name: child.name,
        slug: child.slug,
        parentId: parent.id,
        sortOrder: index,
      },
    });
  }

  console.log(`Seeded ${DEFAULT_CATEGORY_CHILDREN.length} category subcategories.`);
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
