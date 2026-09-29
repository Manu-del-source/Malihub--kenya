import { ListingGridSkeleton } from "@/components/marketplace/listing-skeleton";
import { PageHeaderSkeleton } from "@/components/shared/page-skeleton";

export default function SellerProductsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading products">
      <PageHeaderSkeleton />
      <ListingGridSkeleton count={6} />
    </div>
  );
}
