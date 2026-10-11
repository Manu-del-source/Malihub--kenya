export function ListingCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">
      <div className="skeleton aspect-square" />
      <div className="flex flex-col gap-2.5 p-3 sm:p-3.5">
        <div className="skeleton h-4 w-11/12 rounded" />
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton mt-1 h-6 w-1/2 rounded" />
        <div className="skeleton h-3 w-3/4 rounded" />
        <div className="mt-1 border-t border-border pt-3">
          <div className="skeleton h-3 w-1/2 rounded" />
        </div>
      </div>
    </div>
  );
}

export function ListingGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </div>
  );
}
