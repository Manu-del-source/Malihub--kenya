import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container";
import { ListingForm } from "@/components/marketplace/listing-form";
import { requireAdministrator } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add MaliHub product" };

export default async function NewOfficialListingPage() {
  const { user } = await requireAdministrator();
  if (user.role !== "SUPER_ADMIN") redirect("/admin/listings");

  return (
    <Container className="max-w-3xl py-10">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-400">
          MaliHub Official Store
        </p>
        <h1 className="mt-2 font-display text-3xl font-medium">Add product</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Create a product directly as MaliHub. This does not require a seller application
          and does not change your Super Admin account or permissions.
        </p>
      </header>
      <div className="glass rounded-2xl p-6 sm:p-8">
        <ListingForm adminMode />
      </div>
    </Container>
  );
}
