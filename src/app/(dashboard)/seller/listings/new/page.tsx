import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { ListingForm } from "@/components/marketplace/listing-form";

export const metadata: Metadata = { title: "Create a listing" };

export default function NewListingPage() {
  return (
    <Container className="max-w-2xl py-12">
      <h1 className="mb-1 font-display text-3xl font-medium">Create a listing</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Add clear photos and an accurate description — listings with 3+ photos get noticed faster.
      </p>
      <div className="glass rounded-2xl p-6 sm:p-8">
        <ListingForm />
      </div>
    </Container>
  );
}
