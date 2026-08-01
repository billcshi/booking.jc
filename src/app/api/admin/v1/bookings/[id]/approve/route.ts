import { db } from "@/lib/db";
import { handleAdminApiRequest } from "../../../../../../../../scripts/admin-api-handler.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleAdminApiRequest({ db, request, resource: "action", bookingId: Number(id), action: "approve" });
}

async function unsupported(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAdminApiRequest({ db, request, resource: "action", bookingId: Number(id), action: "approve" });
}

type Context = { params: Promise<{ id: string }> };
export async function DELETE(request: Request, context: Context) { return unsupported(request, context); }
export async function GET(request: Request, context: Context) { return unsupported(request, context); }
export async function OPTIONS(request: Request, context: Context) { return unsupported(request, context); }
export async function PATCH(request: Request, context: Context) { return unsupported(request, context); }
export async function PUT(request: Request, context: Context) { return unsupported(request, context); }
