import { db } from "@/lib/db";
import { handleAdminApiRequest } from "../../../../../../../scripts/admin-api-handler.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return handleAdminApiRequest({ db, request, resource: "booking", bookingId: Number(id) });
}

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  return handleAdminApiRequest({ db, request, resource: "booking", bookingId: Number(id) });
}

async function unsupported(request: Request, { params }: Context) {
  const { id } = await params;
  return handleAdminApiRequest({ db, request, resource: "booking", bookingId: Number(id) });
}

export async function DELETE(request: Request, context: Context) { return unsupported(request, context); }
export async function OPTIONS(request: Request, context: Context) { return unsupported(request, context); }
export async function POST(request: Request, context: Context) { return unsupported(request, context); }
export async function PUT(request: Request, context: Context) { return unsupported(request, context); }
