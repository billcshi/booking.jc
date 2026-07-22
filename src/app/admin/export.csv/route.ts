import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
export const dynamic="force-dynamic";
const csv=(v:unknown)=>`"${String(v??"").replaceAll('"','""')}"`;
export async function GET(){if(!await isAdmin())return new Response("Unauthorized",{status:401});const rows=db.prepare(`SELECT q.id,s.name stay,q.starts_on,q.ends_on,q.party_size,q.status,q.exclusive,q.created_at FROM requests q JOIN stays s ON s.id=q.stay_id WHERE q.deleted_at IS NULL ORDER BY q.starts_on`).all() as Record<string,unknown>[];const keys=["id","stay","starts_on","ends_on","party_size","status","exclusive","created_at"];return new Response([keys.join(","),...rows.map(r=>keys.map(k=>csv(r[k])).join(","))].join("\n"),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=stayboard-export.csv","cache-control":"private, no-store"}})}
