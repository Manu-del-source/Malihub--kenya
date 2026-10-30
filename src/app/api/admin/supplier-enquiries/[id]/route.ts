import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { requireAdminActor, logSafeError } from "@/lib/dropshipping/http";

const schema = z.object({
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "NEGOTIATING", "VERIFICATION_PENDING", "ONBOARDED", "DECLINED"]).optional(),
  internalNotes: z.string().trim().max(4000).nullable().optional(),
  wholesaleTerms: z.string().trim().max(3000).nullable().optional(),
  deliveryTerms: z.string().trim().max(3000).nullable().optional(),
  followUpAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdminActor();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ success: false, error: "Invalid enquiry id." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) return NextResponse.json({ success: false, error: "Invalid enquiry update." }, { status: 400 });
  try {
    const fields = parsed.data;
    const data = await prisma.supplierLead.update({
      where: { id },
      data: {
        ...fields,
        followUpAt: fields.followUpAt === undefined ? undefined : fields.followUpAt ? new Date(fields.followUpAt) : null,
      },
      select: { id: true, status: true, updatedAt: true },
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logSafeError("PATCH /api/admin/supplier-enquiries/[id] failed", error);
    return NextResponse.json({ success: false, error: "Unable to update supplier enquiry." }, { status: 500 });
  }
}
