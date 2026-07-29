import type { Metadata } from "next";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = { title: "Admin dashboard" };

export default function AdminDashboardPage() {
  return (
    <Container className="py-16">
      <div className="glass rounded-2xl p-10 text-center">
        <h1 className="font-display text-3xl font-medium">Admin</h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
          User management, moderation, reports, and payments land here in Phase 6.
          Route access is already restricted to ADMIN/SUPER_ADMIN roles.
        </p>
      </div>
    </Container>
  );
}
