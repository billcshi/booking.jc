import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
export const dynamic="force-dynamic";
export async function GET(){if(!await isAdmin())return Response.json({error:"unauthorized"},{status:401});const rows=db.prepare(`SELECT q.id,s.name stay,q.starts_on,q.ends_on,q.party_size,q.status,q.exclusive,q.created_at FROM requests q JOIN stays s ON s.id=q.stay_id WHERE q.deleted_at IS NULL ORDER BY q.starts_on`).all();return Response.json({exported_at:new Date().toISOString(),requests:rows},{headers:{"cache-control":"private, no-store"}})}
