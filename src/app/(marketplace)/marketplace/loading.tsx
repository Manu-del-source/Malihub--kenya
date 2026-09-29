import { ListingGridSkeleton } from "@/components/marketplace/listing-skeleton";
import { PageHeaderSkeleton } from "@/components/shared/page-skeleton";

export default function MarketplaceLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading marketplace">
      <PageHeaderSkeleton />
      <ListingGridSkeleton count={8} />
    </div>
  );
}
