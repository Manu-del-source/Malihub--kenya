import { redirect } from "next/navigation";

/** Alias into the existing edit-listing flow — see ../../page.tsx. */
export default async function SellerProductRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/seller/listings/${id}/edit`);
}
