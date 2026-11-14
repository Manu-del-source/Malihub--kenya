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

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });

  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Check your address details." }, { status: 400 });
  }

  const data = parsed.data;
  const address = await prisma.$transaction(async (tx) => {
    const owned = await tx.deliveryAddress.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!owned) return null;
    if (data.isDefault) {
      await tx.deliveryAddress.updateMany({ where: { userId: user.id, isDefault: true, NOT: { id } }, data: { isDefault: false } });
    }
    return tx.deliveryAddress.update({
      where: { id },
      data,
      select: {
        id: true, label: true, recipientName: true, phone: true, county: true,
        subCounty: true, town: true, area: true, building: true, landmark: true,
        instructions: true, isDefault: true,
      },
    });
  });
  if (!address) return NextResponse.json({ success: false, error: "Address not found." }, { status: 404 });
  return NextResponse.json({ success: true, data: address });
}

export async function DELETE(request: NextRequest, context: Context) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;
  const user = (await getCurrentUser())?.user;
  if (!user) return NextResponse.json({ success: false, error: "Sign in required." }, { status: 401 });

  const { id } = await context.params;
  const deleted = await prisma.$transaction(async (tx) => {
    const owned = await tx.deliveryAddress.findFirst({ where: { id, userId: user.id } });
    if (!owned) return false;
    await tx.deliveryAddress.delete({ where: { id } });
    if (owned.isDefault) {
      const replacement = await tx.deliveryAddress.findFirst({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (replacement) await tx.deliveryAddress.update({ where: { id: replacement.id }, data: { isDefault: true } });
    }
    return true;
  });
  if (!deleted) return NextResponse.json({ success: false, error: "Address not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}
