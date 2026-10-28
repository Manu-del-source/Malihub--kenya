"use client";

import { deleteCampaignAction } from "@/app/(dashboard)/admin/campaign-actions";

export function CampaignDeleteButton({ id, title }: { id: string; title: string }) {
  return (
    <form
      action={deleteCampaignAction}
      onSubmit={(event) => {
        if (!window.confirm(`Delete the campaign “${title}”? This removes its campaign-product links but does not delete the products.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/10"
      >
        Delete
      </button>
    </form>
  );
}
