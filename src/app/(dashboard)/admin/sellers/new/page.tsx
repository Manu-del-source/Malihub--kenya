import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Container } from "@/components/ui/container";
import { requireAdministrator } from "@/lib/auth";
import { AdminSellerCreateForm } from "@/components/shell/admin/admin-seller-create-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create seller — admin" };

export default async function AdminCreateSellerPage() {
  await requireAdministrator();

  return (
    <Container className="flex flex-col gap-6 py-10">
      <div>
        <Link
          href="/admin/sellers"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to sellers
        </Link>
        <h1 className="mt-4 font-display text-3xl font-medium">Create seller account</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Set up a seller profile manually. The seller receives a secure email link to choose
          their own password.
        </p>
      </div>
      <AdminSellerCreateForm />
    </Container>
  );
}
