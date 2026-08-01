import { db } from "@/lib/db";
import { handleAdminApiRequest } from "../../../../../../scripts/admin-api-handler.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleAdminApiRequest({ db, request, resource: "collection" });
}

async function unsupported(request: Request) {
  return handleAdminApiRequest({ db, request, resource: "collection" });
}

export async function DELETE(request: Request) { return unsupported(request); }
export async function OPTIONS(request: Request) { return unsupported(request); }
export async function PATCH(request: Request) { return unsupported(request); }
export async function POST(request: Request) { return unsupported(request); }
export async function PUT(request: Request) { return unsupported(request); }
