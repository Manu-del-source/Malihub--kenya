"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SortDropdown } from "@/components/marketplace/sort-dropdown";

export function SortDropdownWrapper({ currentSort }: { currentSort: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(sort: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", sort);
    params.delete("cursor");
    router.push(`${pathname}?${params.toString()}`);
  }

  return <SortDropdown value={currentSort} onChange={handleChange} />;
}
