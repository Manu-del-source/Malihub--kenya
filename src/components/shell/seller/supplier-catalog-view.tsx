"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Boxes,
  Check,
  CheckCircle2,
  Filter,
  Globe,
  Info,
  Loader2,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KENYA_COUNTIES } from "@/lib/constants";
import { formatKes } from "@/utils";

export type SupplierAvailability = {
  level: "AVAILABLE" | "LIMITED" | "UNKNOWN" | "STALE" | "UNAVAILABLE";
  label: string;
  isSnapshot: boolean;
  isGuaranteed: boolean;
  canImport: boolean;
  requiresFulfilmentConfirmation: boolean;
  isStale: boolean;
  verifiedAt: string | null;
  ageHours: number | null;
  warnings: string[];
};

export type SupplierCatalogItem = {
  id: string;
  title: string;
  description: string | null;
  sku: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  currency: string;
  availableQuantity: number | null;
  lastSyncedAt: string | null;
  stockStatus?: string;
  stockVerifiedAt?: string | null;
  isActive?: boolean;
  approvalStatus?: string;
  manualRefreshRequired?: boolean;
  supplier: {
    id: string;
    name: string;
    region: "KENYA" | "INTERNATIONAL";
    countryCode: string;
    status?: string;
    deliveryCounties?: string[];
    deliveryEstimateMinDays?: number | null;
    deliveryEstimateMaxDays?: number | null;
  };
  availability?: SupplierAvailability;
  importedListing: {
    id: string;
    slug: string;
    status: string;
  } | null;
};

export type CategoryOption = {
  id: string;
  name: string;
  slug: string;
};

type PaginationInfo = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type ImportFormState = {
  categorySlug: string;
  priceKes: string;
  county: string;
  town: string;
  quantity: number;
  sellerFulfilmentCostKes: string;
};

type PricingPreview = {
  estimatedGrossProfitCents: number;
  marginBps: number;
  isEstimate: boolean;
  warnings: string[];
};

type ImportResponse = {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  data?: {
    id: string;
    title: string;
    slug: string;
    status: string;
    priceCents: number;
    createdAt: string;
  };
  message?: string;
};

export function SupplierCatalogView({
  initialItems,
  initialPagination,
  categories,
  sellerVerified,
}: {
  initialItems: SupplierCatalogItem[];
  initialPagination: PaginationInfo;
  categories: CategoryOption[];
  sellerVerified: boolean;
}) {
  const [items, setItems] = useState<SupplierCatalogItem[]>(initialItems);
  const [pagination, setPagination] = useState<PaginationInfo>(initialPagination);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeRegion, setActiveRegion] = useState<"ALL" | "KENYA" | "INTERNATIONAL">("ALL");
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Selected item for Import Modal
  const [importingItem, setImportingItem] = useState<SupplierCatalogItem | null>(null);
  const [importForm, setImportForm] = useState<ImportFormState>({
    categorySlug: categories[0]?.slug || "",
    priceKes: "",
    county: KENYA_COUNTIES[0] || "Nairobi",
    town: "",
    quantity: 1,
    sellerFulfilmentCostKes: "",
  });
  const [pricingPreview, setPricingPreview] = useState<PricingPreview | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFieldErrors, setImportFieldErrors] = useState<Record<string, string[]>>({});
  const [importedSuccess, setImportedSuccess] = useState<ImportResponse["data"] | null>(null);
  const [existingDraftInfo, setExistingDraftInfo] = useState<{ id: string; slug: string } | null>(null);

  // Selected item for Detail Modal
  const [detailItem, setDetailItem] = useState<SupplierCatalogItem | null>(null);

  const [, startTransition] = useTransition();

  const fetchCatalog = useCallback(
    async (q: string, region: string, page: number) => {
      setIsLoading(true);
      setFetchError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (region !== "ALL") params.set("region", region);
        params.set("page", String(page));
        params.set("limit", "24");

        const res = await fetch(`/api/seller/supplier-products?${params.toString()}`);
        const json = await res.json();
        if (json.success) {
          setItems(json.data);
          setPagination(json.pagination);
        } else {
          setFetchError(json.error || "Unable to load supplier catalog.");
        }
      } catch {
        setFetchError("Unable to reach the server. Please check your connection.");
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    // Only trigger fetch if filters changed from initial defaults
    const timer = setTimeout(() => {
      fetchCatalog(searchQuery, activeRegion, pagination.page);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, activeRegion, pagination.page, fetchCatalog]);

  function handleOpenImport(item: SupplierCatalogItem) {
    if (item.importedListing) {
      setImportingItem(item);
      setExistingDraftInfo({ id: item.importedListing.id, slug: item.importedListing.slug });
      setImportedSuccess(null);
      setImportError(null);
      setImportFieldErrors({});
      return;
    }

    setImportingItem(item);
    setExistingDraftInfo(null);
    setImportedSuccess(null);
    setImportError(null);
    setImportFieldErrors({});
    setImportForm({
      categorySlug: categories[0]?.slug || "",
      priceKes: "",
      county: "Nairobi",
      town: "",
      quantity: 1,
      sellerFulfilmentCostKes: "",
    });
    setPricingPreview(null);
    setPricingError(null);
  }

  useEffect(() => {
    if (!importingItem || !sellerVerified) return;
    const price = Number.parseFloat(importForm.priceKes.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      setPricingPreview(null);
      setPricingError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const fulfilmentCost = Number.parseFloat(importForm.sellerFulfilmentCostKes.replace(/[^0-9.]/g, ""));
        const res = await fetch(`/api/seller/supplier-products/${importingItem.id}/pricing-preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            categorySlug: importForm.categorySlug,
            priceCents: Math.round(price * 100),
            sellerFulfilmentCostCents:
              Number.isFinite(fulfilmentCost) && fulfilmentCost > 0
                ? Math.round(fulfilmentCost * 100)
                : 0,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          setPricingPreview(null);
          setPricingError(json.error || "Pricing preview unavailable.");
          return;
        }
        setPricingError(null);
        setPricingPreview(json.data);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setPricingError("Pricing preview unavailable.");
        }
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    importingItem,
    sellerVerified,
    importForm.categorySlug,
    importForm.priceKes,
    importForm.sellerFulfilmentCostKes,
  ]);

  async function handleSubmitImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importingItem) return;

    setImportError(null);
    setImportFieldErrors({});

    const priceNum = parseFloat(importForm.priceKes.replace(/[^0-9.]/g, ""));
    if (isNaN(priceNum) || priceNum <= 0) {
      setImportError("Please enter a valid retail price in KES.");
      return;
    }
    const priceCents = Math.round(priceNum * 100);

    if (!importForm.town.trim() || importForm.town.trim().length < 2) {
      setImportError("Please enter a valid town or sub-county (at least 2 characters).");
      return;
    }

    setIsSubmittingImport(true);

    try {
      const res = await fetch(`/api/seller/supplier-products/${importingItem.id}/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          categorySlug: importForm.categorySlug,
          priceCents,
          county: importForm.county,
          town: importForm.town.trim(),
          quantity: Math.max(1, importForm.quantity || 1),
          sellerFulfilmentCostCents: Math.round(
            Math.max(0, Number.parseFloat(importForm.sellerFulfilmentCostKes.replace(/[^0-9.]/g, "")) || 0) * 100,
          ),
        }),
      });

      const json = await res.json();

      if (res.status === 201 && json.success) {
        setImportedSuccess(json.data);
        // Update local item list to reflect imported state
        startTransition(() => {
          setItems((prev) =>
            prev.map((it) =>
              it.id === importingItem.id
                ? {
                    ...it,
                    importedListing: {
                      id: json.data.id,
                      slug: json.data.slug,
                      status: json.data.status,
                    },
                  }
                : it,
            ),
          );
        });
      } else if (res.status === 409) {
        setImportError(json.error || "You have already imported this supplier product.");
        if (json.data?.id) {
          setExistingDraftInfo({ id: json.data.id, slug: json.data.slug });
        }
      } else if (res.status === 400 && json.fieldErrors) {
        setImportFieldErrors(json.fieldErrors);
        setImportError(json.error || "Please correct the highlighted fields.");
      } else {
        setImportError(json.error || "Failed to import supplier product. Please try again.");
      }
    } catch {
      setImportError("A network error occurred. Please try again.");
    } finally {
      setIsSubmittingImport(false);
    }
  }

  return (
    <div>
      {/* ── Seller Verification Notice ─────────────────────────────────────── */}
      {!sellerVerified && (
        <section
          className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 sm:p-6"
          aria-label="Verification required for product imports"
        >
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
            <div>
              <h2 className="font-semibold text-white">Seller verification required to import products</h2>
              <p className="mt-1 text-sm text-white/70">
                You can browse approved supplier catalogs below. To import items into your inventory as draft listings,
                your seller account must be approved by MaliHub moderation.
              </p>
              <Link
                href="/seller/onboarding"
                className="mt-3 inline-flex text-sm font-semibold text-[#FF8C42] underline underline-offset-4 hover:text-white"
              >
                Complete seller application →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── Sourcing Rules / Guidelines Banner ────────────────────────────── */}
      <div className="mb-8 rounded-2xl border border-white/10 bg-[#141414] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#FF8C42]" aria-hidden />
            <div className="text-sm">
              <p className="font-medium text-white">How MaliHub Dropshipping Sourcing Works</p>
              <p className="mt-0.5 text-white/60">
                1. Browse vetted suppliers. 2. Set your retail price in KES. 3. Import as a Draft. 4. Verify supplier availability and upload photos in the listing editor before publishing.
              </p>
            </div>
          </div>
          <Link
            href="/seller/listings"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/80 transition hover:border-[#FF8C42]/40 hover:text-white"
          >
            <Package className="h-3.5 w-3.5" aria-hidden />
            View my listings
          </Link>
        </div>
      </div>

      {/* ── Search & Filter Controls ──────────────────────────────────────── */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
          <input
            type="search"
            placeholder="Search supplier products, descriptions, SKUs..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPagination((prev) => ({ ...prev, page: 1 }));
            }}
            className="h-11 w-full rounded-full border border-white/10 bg-[#1A1A1A] pl-10 pr-4 text-sm text-white placeholder:text-white/40 outline-none transition focus:border-[#FF8C42]/60 focus:ring-2 focus:ring-[#FF8C42]/15"
          />
        </div>

        {/* Region Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0" aria-label="Filter by region">
          <span className="hidden items-center gap-1.5 text-xs text-white/50 sm:flex">
            <Filter className="h-3.5 w-3.5" aria-hidden /> Region:
          </span>
          {(
            [
              { id: "ALL", label: "All regions" },
              { id: "KENYA", label: "Kenya suppliers" },
              { id: "INTERNATIONAL", label: "International" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveRegion(tab.id);
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
              className={[
                "shrink-0 rounded-full px-4 py-2 text-xs font-medium transition",
                activeRegion === tab.id
                  ? "bg-[#FF8C42] font-semibold text-black"
                  : "border border-white/10 bg-[#141414] text-white/70 hover:border-white/20 hover:text-white",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error state ──────────────────────────────────────────────────── */}
      {fetchError && (
        <div className="mb-8 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-300">
          <p className="font-medium">{fetchError}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => fetchCatalog(searchQuery, activeRegion, pagination.page)}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {/* ── Loading Skeleton / Results Grid ───────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-2xl border border-white/10 bg-[#141414] p-4">
              <div className="aspect-square w-full rounded-xl bg-white/5" />
              <div className="mt-4 h-4 w-3/4 rounded bg-white/5" />
              <div className="mt-2 h-3 w-1/2 rounded bg-white/5" />
              <div className="mt-4 h-9 w-full rounded-full bg-white/5" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-[#141414] py-20 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#FF8C42]">
            <Boxes className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-white">No supplier products found</h2>
          <p className="mx-auto mt-2 max-w-md px-5 text-sm leading-6 text-white/60">
            {searchQuery
              ? `No products matched "${searchQuery}". Try refining your search terms.`
              : "No active supplier products are currently available in this category."}
          </p>
          {(searchQuery || activeRegion !== "ALL") && (
            <Button
              variant="outline"
              size="sm"
              className="mt-5"
              onClick={() => {
                setSearchQuery("");
                setActiveRegion("ALL");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-[#141414] p-4 transition hover:border-[#FF8C42]/40"
            >
              <div>
                {/* Product Image preview */}
                <div
                  className="relative aspect-square w-full cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-[#1A1A1A]"
                  onClick={() => setDetailItem(item)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setDetailItem(item);
                  }}
                  aria-label={`View details for ${item.title}`}
                >
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.title}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      className="object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/20">
                      <Package className="h-12 w-12" aria-hidden />
                    </div>
                  )}

                  {/* Supplier Region Badge */}
                  <div className="absolute left-2.5 top-2.5">
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/70 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
                      {item.supplier.region === "KENYA" ? (
                        <>
                          <MapPin className="h-3 w-3 text-[#FF8C42]" aria-hidden /> Kenya
                        </>
                      ) : (
                        <>
                          <Globe className="h-3 w-3 text-cyan-400" aria-hidden /> International
                        </>
                      )}
                    </span>
                  </div>

                  {item.importedListing && (
                    <div className="absolute right-2.5 top-2.5">
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/80 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 backdrop-blur-md">
                        <Check className="h-3 w-3" aria-hidden /> Imported
                      </span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="mt-3.5">
                  <p className="text-xs font-medium text-white/50">{item.supplier.name}</p>
                  <h3
                    className="mt-1 line-clamp-2 cursor-pointer font-medium text-white transition group-hover:text-[#FF8C42]"
                    onClick={() => setDetailItem(item)}
                  >
                    {item.title}
                  </h3>
                  {item.description && (
                    <p className="mt-1.5 line-clamp-2 text-xs text-white/60">{item.description}</p>
                  )}
                </div>
              </div>

              {/* Bottom metadata and action */}
              <div className="mt-4 border-t border-white/5 pt-3">
                <div className="mb-3 flex items-center justify-between text-xs text-white/50">
                  <span className={item.availability?.isStale ? "text-amber-300" : undefined}>
                    {item.availability
                      ? `${item.availability.label}${
                          item.availableQuantity !== null
                            ? ` · ${item.availableQuantity.toLocaleString()} units`
                            : ""
                        }`
                      : item.availableQuantity !== null
                        ? `${item.availableQuantity.toLocaleString()} in stock (snapshot)`
                        : "Stock not verified"}
                  </span>
                  {item.sku && <span className="font-mono text-[11px]">SKU: {item.sku}</span>}
                </div>

                {item.importedListing ? (
                  <Link
                    href={`/seller/listings/${item.importedListing.id}/edit`}
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    Edit draft listing
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    className="w-full rounded-full bg-[#FF8C42] text-xs font-bold text-black transition hover:bg-[#ff9b5c]"
                    onClick={() => handleOpenImport(item)}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    Import to inventory
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {pagination.totalPages > 1 && (
        <div className="mt-10 flex items-center justify-between border-t border-white/10 pt-6">
          <p className="text-xs text-white/50">
            Showing page <span className="font-medium text-white">{pagination.page}</span> of{" "}
            <span className="font-medium text-white">{pagination.totalPages}</span> ({pagination.total} total items)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1 || isLoading}
              onClick={() => setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages || isLoading}
              onClick={() =>
                setPagination((prev) => ({
                  ...prev,
                  page: Math.min(pagination.totalPages, prev.page + 1),
                }))
              }
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ── Product Detail Modal ──────────────────────────────────────────── */}
      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#141414] p-6 text-white sm:p-8">
            <button
              type="button"
              onClick={() => setDetailItem(null)}
              className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-[#1A1A1A]">
              {detailItem.imageUrl ? (
                <Image src={detailItem.imageUrl} alt={detailItem.title} fill className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/20">
                  <Package className="h-12 w-12" />
                </div>
              )}
            </div>

            <div className="mt-5">
              <div className="flex items-center gap-2">
                <Badge variant={detailItem.supplier.region === "KENYA" ? "verified" : "default"}>
                  {detailItem.supplier.region === "KENYA" ? "Kenya Supplier" : "International Supplier"}
                </Badge>
                <span className="text-xs text-white/50">{detailItem.supplier.name}</span>
              </div>

              <h2 className="mt-2 font-display text-xl font-medium">{detailItem.title}</h2>

              {detailItem.description && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">
                    Product Description
                  </h4>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/70">
                    {detailItem.description}
                  </p>
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-white/5 bg-[#1A1A1A] p-4 text-xs">
                <div>
                  <span className="text-white/50">SKU:</span>
                  <p className="font-mono font-medium text-white">{detailItem.sku || "N/A"}</p>
                </div>
                <div>
                  <span className="text-white/50">Available Units:</span>
                  <p className="font-medium text-white">
                    {detailItem.availableQuantity !== null
                      ? detailItem.availableQuantity.toLocaleString()
                      : "Available on order"}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-white/70">
                <p className="font-medium text-amber-200">
                  {detailItem.availability?.label ?? "Stock not verified"}
                </p>
                <p className="mt-1">
                  Supplier stock is a last-known snapshot, not a live reservation. Confirm availability and delivery time with the supplier before publishing or accepting an order.
                </p>
                {detailItem.supplier.deliveryEstimateMaxDays ? (
                  <p className="mt-1">
                    Supplier delivery estimate: up to {detailItem.supplier.deliveryEstimateMaxDays} days where verified.
                  </p>
                ) : null}
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <Button variant="outline" onClick={() => setDetailItem(null)}>
                  Close
                </Button>
                {detailItem.importedListing ? (
                  <Button asChild className="rounded-full bg-emerald-500 text-black hover:bg-emerald-400">
                    <Link href={`/seller/listings/${detailItem.importedListing.id}/edit`}>
                      Edit Draft Listing
                    </Link>
                  </Button>
                ) : (
                  <Button
                    className="rounded-full bg-[#FF8C42] font-bold text-black hover:bg-[#ff9b5c]"
                    onClick={() => {
                      const item = detailItem;
                      setDetailItem(null);
                      handleOpenImport(item);
                    }}
                  >
                    Import to inventory
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Import Form Modal / Dialog ────────────────────────────────────── */}
      {importingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#141414] p-6 text-white sm:p-8">
            <button
              type="button"
              onClick={() => {
                setImportingItem(null);
                setImportedSuccess(null);
                setExistingDraftInfo(null);
              }}
              className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Success state */}
            {importedSuccess ? (
              <div className="py-4 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                  <CheckCircle2 className="h-7 w-7" aria-hidden />
                </div>
                <h3 className="mt-4 font-display text-2xl font-medium text-white">Imported as Draft</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm text-white/70">
                  &quot;{importedSuccess.title}&quot; has been created in your inventory.
                </p>

                <div className="my-6 rounded-2xl border border-white/10 bg-[#1A1A1A] p-4 text-left text-xs">
                  <div className="flex justify-between py-1">
                    <span className="text-white/50">Status:</span>
                    <Badge variant="default">{importedSuccess.status}</Badge>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-white/50">Retail Price:</span>
                    <span className="font-mono font-medium text-white">
                      {formatKes(importedSuccess.priceCents)}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                  <p>
                    Important: Add your own product photos and verify details before publishing your listing to the marketplace.
                  </p>
                </div>

                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setImportingItem(null);
                      setImportedSuccess(null);
                    }}
                  >
                    Continue browsing
                  </Button>
                  <Button asChild className="rounded-full bg-[#FF8C42] font-bold text-black hover:bg-[#ff9b5c]">
                    <Link href={`/seller/listings/${importedSuccess.id}/edit`}>
                      Edit draft listing
                    </Link>
                  </Button>
                </div>
              </div>
            ) : existingDraftInfo ? (
              <div className="py-4 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400">
                  <Info className="h-7 w-7" aria-hidden />
                </div>
                <h3 className="mt-4 font-display text-xl font-medium text-white">Already in Inventory</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm text-white/70">
                  You have already imported this product. You can review or edit your listing draft directly.
                </p>

                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setImportingItem(null);
                      setExistingDraftInfo(null);
                    }}
                  >
                    Close
                  </Button>
                  <Button asChild className="rounded-full bg-[#FF8C42] font-bold text-black hover:bg-[#ff9b5c]">
                    <Link href={`/seller/listings/${existingDraftInfo.id}/edit`}>
                      Open draft listing
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-5">
                  <Badge variant="verified">{importingItem.supplier.name}</Badge>
                  <h3 className="mt-2 font-display text-xl font-medium text-white">
                    Import to your inventory
                  </h3>
                  <p className="mt-1 line-clamp-1 text-sm text-white/60">{importingItem.title}</p>
                </div>

                {importError && (
                  <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-300">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <p>{importError}</p>
                  </div>
                )}

                {!sellerVerified ? (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm">
                    <p className="font-semibold text-white">Verification required</p>
                    <p className="mt-1 text-white/70">
                      Your seller account must be approved before importing supplier products into inventory.
                    </p>
                    <Button asChild className="mt-4 rounded-full bg-[#FF8C42] text-black">
                      <Link href="/seller/onboarding">Complete verification</Link>
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitImport} className="space-y-4">
                    {/* Category Selection */}
                    <div>
                      <label className="block text-xs font-medium text-white/70">
                        Category <span className="text-red-400">*</span>
                      </label>
                      <select
                        value={importForm.categorySlug}
                        onChange={(e) =>
                          setImportForm((prev) => ({ ...prev, categorySlug: e.target.value }))
                        }
                        className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-[#1A1A1A] px-3.5 text-sm text-white outline-none focus:border-[#FF8C42]/60 focus:ring-1 focus:ring-[#FF8C42]"
                      >
                        {categories.map((c) => (
                          <option key={c.slug} value={c.slug} className="bg-[#1A1A1A] text-white">
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {importFieldErrors.categorySlug && (
                        <p className="mt-1 text-xs text-red-400">{importFieldErrors.categorySlug[0]}</p>
                      )}
                    </div>

                    {/* Retail Price in KES */}
                    <div>
                      <label className="block text-xs font-medium text-white/70">
                        Your intended retail price (KES) <span className="text-red-400">*</span>
                      </label>
                      <div className="relative mt-1.5">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-white/40">
                          KSh
                        </span>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          placeholder="e.g. 2500"
                          value={importForm.priceKes}
                          onChange={(e) =>
                            setImportForm((prev) => ({ ...prev, priceKes: e.target.value }))
                          }
                          className="h-11 rounded-xl border-white/10 bg-[#1A1A1A] pl-12 text-sm text-white"
                          required
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-white/50">
                        Enter your target retail price including your margin.
                      </p>
                      {importFieldErrors.priceCents && (
                        <p className="mt-1 text-xs text-red-400">{importFieldErrors.priceCents[0]}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-white/70">
                        Your own fulfilment cost in KES (optional)
                      </label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="e.g. 300"
                        value={importForm.sellerFulfilmentCostKes}
                        onChange={(e) =>
                          setImportForm((prev) => ({ ...prev, sellerFulfilmentCostKes: e.target.value }))
                        }
                        className="mt-1.5 h-11 rounded-xl border-white/10 bg-[#1A1A1A] text-sm text-white"
                      />
                      <p className="mt-1 text-[11px] text-white/50">
                        Enter only costs you actually pay. Unknown platform, tax and payment fees are not invented.
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-[#111]/80 p-3.5 text-xs" aria-live="polite">
                      {pricingPreview ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-white/60">Estimated gross profit</span>
                            <span className="font-mono text-sm font-semibold text-white">
                              {formatKes(pricingPreview.estimatedGrossProfitCents)}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-white/60">Estimated margin</span>
                            <span className="font-mono text-sm text-white">
                              {(pricingPreview.marginBps / 100).toFixed(2)}%
                            </span>
                          </div>
                          <p className="mt-2 text-[11px] text-amber-300">
                            {pricingPreview.isEstimate
                              ? "Estimate only — supplier cost, delivery charge or fee configuration is not fully verified."
                              : "Based on verified inputs. Final supplier cost must still be confirmed before purchase."}
                          </p>
                          {pricingPreview.warnings.length > 0 ? (
                            <p className="mt-1 text-[11px] text-white/50">
                              {pricingPreview.warnings.join(", ")}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="text-white/60">
                          {pricingError ?? "Enter a retail price to preview estimated profit and margin before publishing."}
                        </p>
                      )}
                    </div>

                    {/* County & Town */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-medium text-white/70">
                          County <span className="text-red-400">*</span>
                        </label>
                        <select
                          value={importForm.county}
                          onChange={(e) =>
                            setImportForm((prev) => ({ ...prev, county: e.target.value }))
                          }
                          className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-[#1A1A1A] px-3.5 text-sm text-white outline-none focus:border-[#FF8C42]/60 focus:ring-1 focus:ring-[#FF8C42]"
                        >
                          {KENYA_COUNTIES.map((county) => (
                            <option key={county} value={county} className="bg-[#1A1A1A] text-white">
                              {county}
                            </option>
                          ))}
                        </select>
                        {importFieldErrors.county && (
                          <p className="mt-1 text-xs text-red-400">{importFieldErrors.county[0]}</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-white/70">
                          Town / Sub-county <span className="text-red-400">*</span>
                        </label>
                        <Input
                          type="text"
                          placeholder="e.g. Westlands, CBD"
                          value={importForm.town}
                          onChange={(e) =>
                            setImportForm((prev) => ({ ...prev, town: e.target.value }))
                          }
                          className="mt-1.5 h-11 rounded-xl border-white/10 bg-[#1A1A1A] text-sm text-white"
                          required
                        />
                        {importFieldErrors.town && (
                          <p className="mt-1 text-xs text-red-400">{importFieldErrors.town[0]}</p>
                        )}
                      </div>
                    </div>

                    {/* Quantity */}
                    <div>
                      <label className="block text-xs font-medium text-white/70">
                        Listing quantity <span className="text-red-400">*</span>
                      </label>
                      <Input
                        type="number"
                        min="1"
                        max="9999"
                        value={importForm.quantity}
                        onChange={(e) =>
                          setImportForm((prev) => ({
                            ...prev,
                            quantity: parseInt(e.target.value, 10) || 1,
                          }))
                        }
                        className="mt-1.5 h-11 rounded-xl border-white/10 bg-[#1A1A1A] text-sm text-white"
                        required
                      />
                      {importFieldErrors.quantity && (
                        <p className="mt-1 text-xs text-red-400">{importFieldErrors.quantity[0]}</p>
                      )}
                    </div>

                    <div className="rounded-xl border border-white/5 bg-[#1A1A1A] p-3 text-[11px] text-white/60">
                      Importing creates a <strong className="text-white">Draft listing</strong> in your seller inventory. You will be able to review the description, set delivery details, and upload photos before publishing.
                    </div>

                    <div className="mt-6 flex items-center justify-end gap-3 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setImportingItem(null)}
                        disabled={isSubmittingImport}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={isSubmittingImport}
                        className="rounded-full bg-[#FF8C42] font-bold text-black hover:bg-[#ff9b5c]"
                      >
                        {isSubmittingImport ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          "Import as draft"
                        )}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
