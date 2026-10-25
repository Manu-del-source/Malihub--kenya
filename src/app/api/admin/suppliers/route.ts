import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, isAdministratorRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  region: z.enum(["KENYA", "INTERNATIONAL"]),
  countryCode: z.string().trim().length(2).transform((v) => v.toUpperCase()),
  contactEmail: z.string().trim().email().max(254).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  websiteUrl: z.string().trim().url().max(2048).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional(),
});

async function adminResponse() {
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });
  if (!isAdministratorRole(user.role) || !user.isActive || user.isBanned) {
    return NextResponse.json({ success: false, error: "Administrator access is required." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await adminResponse();
  if (denied) return denied;

  try {
    const data = await prisma.supplier.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, slug: true, region: true, countryCode: true,
        status: true, contactEmail: true, contactPhone: true, websiteUrl: true,
        approvedAt: true, createdAt: true, updatedAt: true,
        _count: { select: { products: true } },
      },
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("GET /api/admin/suppliers failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load suppliers." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const denied = await adminResponse();
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const v = parsed.data;
  try {
    const data = await prisma.supplier.create({
      data: {
        name: v.name, slug: v.slug, region: v.region, countryCode: v.countryCode,
        contactEmail: v.contactEmail || null, contactPhone: v.contactPhone || null,
        websiteUrl: v.websiteUrl || null, notes: v.notes || null, status: "PENDING",
      },
      select: { id: true, name: true, slug: true, region: true, countryCode: true, status: true, createdAt: true },
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ success: false, error: "Supplier slug already exists." }, { status: 409 });
    }
    console.error("POST /api/admin/suppliers failed", error);
    return NextResponse.json({ success: false, error: "Unable to create supplier." }, { status: 500 });
  }
}
