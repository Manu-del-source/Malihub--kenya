import { redirect } from "next/navigation";

/** Alias into the existing create-listing flow — see ../page.tsx. */
export default function NewSellerProductRedirect() {
  redirect("/seller/listings/new");
}
