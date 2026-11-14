import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySameOrigin } from "@/lib/csrf";
import { KENYA_COUNTIES } from "@/lib/constants";

const schema = z.object({
  label: z.string().trim().min(1).max(40).default("Home"),
  recipientName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(9).max(16).regex(/^\\+?[0-9\\s()-]+$/),
  county: z.string().refine((value) => (KENYA_COUNTIES as readonly string[]).includes(value), "Choose a valid county."),
  subCounty: z.string().trim().max(100).optional().default(""),
  town: z.string().trim().min(2).max(100),
  area: z.string().trim().max(120).optional().default(""),
  building: z.string().trim().max(160).optional().default(""),
  landmark: z.string().trim().max(160).optional().default(""),
  instructions: z.string().trim().max(300).optional().default(""),
  isDefault: z.boolean().optional().default(false),
});

export async function GET() {
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });

  const addresses = await prisma.deliveryAddress.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true, label: true, recipientName: true, phone: true, county: true,
      subCounty: true, town: true, area: true, building: true, landmark: true,
      instructions: true, isDefault: true,
    },
  });
  return NextResponse.json({ success: true, data: addresses });
}

export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Check your address details." }, { status: 400 });
  }

  const data = parsed.data;
  const address = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.deliveryAddress.updateMany({ where: { userId: user.id, isDefault: true }, data: { isDefault: false } });
    }
    const existingCount = await tx.deliveryAddress.count({ where: { userId: user.id } });
    return tx.deliveryAddress.create({
      data: { ...data, isDefault: data.isDefault || existingCount === 0, userId: user.id },
      select: {
        id: true, label: true, recipientName: true, phone: true, county: true,
        subCounty: true, town: true, area: true, building: true, landmark: true,
        instructions: true, isDefault: true,
      },
    });
  });
  return NextResponse.json({ success: true, data: address }, { status: 201 });
}
