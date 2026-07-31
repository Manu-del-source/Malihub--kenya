export function ListingCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="skeleton aspect-[4/3]" />
      <div className="flex flex-col gap-2 p-4">
        <div className="skeleton h-5 w-24 rounded" />
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-3 w-2/3 rounded" />
        <div className="mt-2 border-t border-border pt-2">
          <div className="skeleton h-3 w-1/2 rounded" />
        </div>
      </div>
    </div>
  );
}

export function ListingGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </div>
  );
}
