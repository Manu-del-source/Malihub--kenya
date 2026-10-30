import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { rateLimit, formatRetryAfter } from "@/lib/rate-limit";
import { logSafeError } from "@/lib/dropshipping/http";

export const runtime = "nodejs";

const enquirySchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(7).max(40),
  location: z.string().trim().max(120).optional().default(""),
  categories: z.array(z.string().trim().min(2).max(80)).min(1).max(8),
  catalogueUrl: z.string().trim().url().max(2048).optional().or(z.literal("")),
  websiteUrl: z.string().trim().url().max(2048).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().default(""),
  // Honeypot. Real visitors never see or fill this field.
  companyWebsite: z.string().max(200).optional().default(""),
});

export async function POST(request: NextRequest) {
  const csrf = verifySameOrigin(request);
  if (csrf) return csrf;

  const body = await request.json().catch(() => null);
  const parsed = enquirySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Check the required fields and try again.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // Silently accept bot submissions without storing them.
  if (parsed.data.companyWebsite) {
    return NextResponse.json({ success: true, message: "Thank you. Your enquiry has been received." }, { status: 201 });
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  try {
    const limit = await rateLimit.supplierEnquiry(ip);
    if (!limit.success) {
      return NextResponse.json(
        { success: false, error: `Too many enquiries. Try again in ${formatRetryAfter(limit.reset)}.` },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) } },
      );
    }

    const { companyWebsite: _honeypot, ...data } = parsed.data;
    const enquiry = await prisma.supplierLead.create({
      data: {
        companyName: data.companyName,
        contactName: data.contactName,
        email: data.email.toLowerCase(),
        phone: data.phone,
        location: data.location || null,
        categories: data.categories,
        catalogueUrl: data.catalogueUrl || null,
        websiteUrl: data.websiteUrl || null,
        message: data.message || null,
      },
      select: { id: true },
    });
    return NextResponse.json(
      { success: true, message: "Thank you. Your enquiry has been received. Our team will review it and contact you.", reference: enquiry.id.slice(0, 8).toUpperCase() },
      { status: 201 },
    );
  } catch (error) {
    logSafeError("POST /api/supplier-enquiries failed", error);
    return NextResponse.json({ success: false, error: "We could not submit your enquiry. Please try again later." }, { status: 500 });
  }
}
