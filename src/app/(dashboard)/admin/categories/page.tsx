import type { Metadata } from "next";
import { FolderTree } from "lucide-react";
import { Container } from "@/components/ui/container";
import { AdminCategoryManager } from "@/components/shell/admin/admin-category-manager";
import { requireAdministrator } from "@/lib/auth";
import { listAdminCategories } from "@/services/admin-service";

/**
 * `/admin/categories` — the marketplace's REAL category table.
 *
 * Categories here are not an admin-only shadow list: they are the rows
 * `prisma/seed.ts` provisions from the `DEFAULT_CATEGORIES` reference set,
 * and every public surface (category pages, marketplace browser, listing
 * forms via `categorySlug`, the `/api/categories` route) reads them from the
 * same table. Editing here therefore changes the marketplace itself — which
 * is exactly why deletion is blocked while listings exist (the schema's
 * `onDelete: Restrict` on `Product.categoryId`) and "hide" is a flag
 * (`isActive`), not a delete.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Categories — admin" };

export default async function AdminCategoriesPage() {
  await requireAdministrator();

  const categories = await listAdminCategories();

  return (
    <Container className="flex flex-col gap-6 py-10">
      <header>
        <h1 className="font-display text-3xl font-medium">Categories</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <FolderTree className="h-4 w-4" aria-hidden />
          {categories.length} categor{categories.length === 1 ? "y" : "ies"} · shared by the
          marketplace, listing forms, and category pages
        </p>
      </header>

      <AdminCategoryManager categories={categories} />

      <p className="text-xs text-muted-foreground">
        Inactive categories disappear from public browsing and search filters; existing listings
        keep their category. Every change here is recorded in the audit log.
      </p>
    </Container>
  );
}
