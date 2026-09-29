import { Container } from "@/components/ui/container";
import { PageSkeleton } from "@/components/shared/page-skeleton";

/** Route-level loading for every `/admin` screen (Next picks the nearest
 * `loading.tsx`), matching the pattern the buyer/seller dashboards use. */
export default function AdminLoading() {
  return (
    <Container className="py-12">
      <PageSkeleton rows={6} />
    </Container>
  );
}
