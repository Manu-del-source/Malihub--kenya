import { DetailSkeleton } from "@/components/shared/page-skeleton";

export default function ProductDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <DetailSkeleton />
    </div>
  );
}
