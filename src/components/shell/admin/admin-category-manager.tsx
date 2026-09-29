"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "@/app/(dashboard)/admin/actions";
import { cn } from "@/utils";

/**
 * Category management for the marketplace's REAL `categories` table (not a
 * parallel admin-only list). Sellers pick from these slugs when listing, so
 * a category in use cannot be deleted — it can be deactivated (hidden from
 * browsing) and the UI says so with the live product count.
 *
 * The component sends { name, sortOrder, isActive } / { id, note } payloads
 * to Server Actions; nothing about the actor or role travels in the request.
 */
export type AdminCategoryItem = {
  id: string;
  name: string;
  slug: string;
  iconName: string | null;
  sortOrder: number;
  isActive: boolean;
  parentId: string | null;
  parent: { id: string; name: string } | null;
  children: { id: string; name: string; slug: string }[];
  _count: { products: number };
};

export function AdminCategoryManager({ categories }: { categories: AdminCategoryItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const parents = categories.filter((category) => !category.parentId);

  function run<T>(action: () => Promise<T>, success: string) {
    startTransition(async () => {
      const result = (await action()) as { success: boolean; error?: string };
      if (!result.success) {
        toast.error(result.error ?? "That action could not be completed.");
        return;
      }
      toast.success(success);
      setEditingId(null);
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {categories.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No categories yet — run the reference seed (prisma/seed.ts) or create the first one below.
        </p>
      )}

      <ul className="glass flex flex-col divide-y divide-border rounded-2xl">
        {categories.map((category) => {
          const editing = editingId === category.id;
          return (
            <li key={category.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  {editing ? (
                    <EditRow
                      category={category}
                      isPending={isPending}
                      onCancel={() => setEditingId(null)}
                      onSave={(input) => run(() => updateCategoryAction(input), "Category updated.")}
                    />
                  ) : (
                    <>
                      <p className="truncate text-sm font-medium">
                        {category.name}{" "}
                        <span className="font-mono text-xs text-muted-foreground">/{category.slug}</span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {category._count.products.toLocaleString()} listing
                          {category._count.products === 1 ? "" : "s"}
                        </span>
                        <span aria-hidden>·</span>
                        <span>sort {category.sortOrder}</span>
                        {category.parent && (
                          <>
                            <span aria-hidden>·</span>
                            <span>under {category.parent.name}</span>
                          </>
                        )}
                        {category.children.length > 0 && (
                          <>
                            <span aria-hidden>·</span>
                            <span>{category.children.length} sub-categories</span>
                          </>
                        )}
                      </p>
                    </>
                  )}
                </div>
                {!editing && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={category.isActive ? "cyan" : "default"}>
                      {category.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => run(
                        () => updateCategoryAction({
                          id: category.id,
                          name: category.name,
                          sortOrder: category.sortOrder,
                          isActive: !category.isActive,
                        }),
                        category.isActive ? "Category deactivated." : "Category activated."
                      )}
                    >
                      {category.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => {
                        setEditingId(category.id);
                        setConfirmDeleteId(null);
                      }}
                      aria-label={`Edit ${category.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    {confirmDeleteId === category.id ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        Delete?
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          className="h-8 bg-destructive/15 text-destructive hover:bg-destructive/20"
                          onClick={() =>
                            run(() => deleteCategoryAction({ id: category.id }), "Category deleted.")
                          }
                        >
                          Confirm
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending || category._count.products > 0 || category.children.length > 0}
                        title={
                          category._count.products > 0
                            ? "Category has listings — move them first, or deactivate the category"
                            : category.children.length > 0
                              ? "Category has sub-categories — move them first"
                              : "Delete category"
                        }
                        className="text-destructive"
                        onClick={() => setConfirmDeleteId(category.id)}
                        aria-label={`Delete ${category.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {createOpen ? (
        <CreateForm
          parents={parents}
          isPending={isPending}
          onCancel={() => setCreateOpen(false)}
          onCreate={(input) => run(() => createCategoryAction(input), "Category created.")}
        />
      ) : (
        <div>
          <Button size="sm" variant="secondary" disabled={isPending} onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New category
          </Button>
        </div>
      )}
    </div>
  );
}

function EditRow({
  category,
  isPending,
  onSave,
  onCancel,
}: {
  category: AdminCategoryItem;
  isPending: boolean;
  onSave: (input: { id: string; name: string; sortOrder: number; isActive: boolean }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [isActive, setIsActive] = useState(category.isActive);

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ id: category.id, name: name.trim(), sortOrder: Number(sortOrder), isActive });
      }}
    >
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={60}
        aria-label="Category name"
        className="h-9 w-48 text-sm"
      />
      <Input
        value={sortOrder}
        onChange={(event) => setSortOrder(event.target.value)}
        inputMode="numeric"
        aria-label="Sort order"
        className={cn("h-9 w-20 text-sm")}
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
        />
        Active
      </label>
      <Button size="sm" type="submit" disabled={isPending}>
        Save
      </Button>
      <Button size="sm" type="button" variant="ghost" disabled={isPending} onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function CreateForm({
  parents,
  isPending,
  onCreate,
  onCancel,
}: {
  parents: AdminCategoryItem[];
  isPending: boolean;
  onCreate: (input: {
    name: string;
    slug?: string;
    parentId?: string;
    sortOrder: string;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [sortOrder, setSortOrder] = useState("0");

  return (
    <form
      className="glass-sm flex flex-wrap items-end gap-3 rounded-2xl p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate({
          name: name.trim(),
          slug: slug.trim() || undefined,
          parentId: parentId || undefined,
          sortOrder,
        });
      }}
    >
      <label className="text-sm">
        <span className="text-muted-foreground">Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} className="mt-1 w-52" />
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground">Slug (optional)</span>
        <Input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          maxLength={60}
          pattern="[a-z0-9]*(-[a-z0-9]+)*"
          title="Lowercase letters, numbers and hyphens"
          placeholder="derived from the name"
          className="mt-1 w-44"
        />
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground">Parent</span>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="mt-1 block h-11 w-44 rounded-xl border border-border bg-background/60 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">None (top level)</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground">Sort order</span>
        <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} inputMode="numeric" className="mt-1 w-20" />
      </label>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Creating…" : "Create category"}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
