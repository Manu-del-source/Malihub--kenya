/**
 * Skeleton primitives for route-level `loading.tsx` files.
 *
 * These mirror the shape of the real dashboards (header strip + stacked
 * rows) so navigation feels instant instead of flashing an empty screen
 * while the server component stream resolves. Uses the same `.skeleton`
 * shimmer defined in globals.css as ListingCardSkeleton.
 */

export function PageHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="skeleton h-8 w-56 rounded" />
      <div className="skeleton h-4 w-80 max-w-full rounded" />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
      <div className="skeleton h-12 w-12 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="skeleton h-4 w-1/3 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
      </div>
      <div className="skeleton hidden h-6 w-20 rounded-full sm:block" />
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <RowSkeleton key={i} />
      ))}
    </div>
  );
}

export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      <PageHeaderSkeleton />
      <ListSkeleton rows={rows} />
    </div>
  );
}

/** Two-column product-detail stand-in: media block + info block. */
export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row" aria-busy="true" aria-label="Loading">
      <div className="skeleton aspect-[4/3] w-full rounded-2xl lg:w-3/5" />
      <div className="flex w-full flex-col gap-4 lg:w-2/5">
        <div className="skeleton h-4 w-32 rounded" />
        <div className="skeleton h-9 w-3/4 rounded" />
        <div className="skeleton h-8 w-40 rounded" />
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-4 w-5/6 rounded" />
        <div className="skeleton h-11 w-full rounded-xl" />
        <div className="skeleton h-11 w-full rounded-xl" />
      </div>
    </div>
  );
}
