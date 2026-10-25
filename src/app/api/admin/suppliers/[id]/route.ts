import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, isAdministratorRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";

const schema = z.object({ status: z.enum(["APPROVED", "REJECTED", "SUSPENDED", "PENDING"]) });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  if (!isAdministratorRole(user.role) || !user.isActive || user.isBanned) {
    return NextResponse.json({ success: false, error: "Administrator access is required." }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid supplier status." }, { status: 400 });
  }

  try {
    const data = await prisma.supplier.update({
      where: { id },
      data: {
        status: parsed.data.status,
        approvedAt: parsed.data.status === "APPROVED" ? new Date() : null,
      },
      select: { id: true, name: true, status: true, approvedAt: true, updatedAt: true },
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
      return NextResponse.json({ success: false, error: "Supplier not found." }, { status: 404 });
    }
    console.error("PATCH /api/admin/suppliers/[id] failed", error);
    return NextResponse.json({ success: false, error: "Unable to update supplier." }, { status: 500 });
  }
}
