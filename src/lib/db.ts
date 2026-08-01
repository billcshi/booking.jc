import type Database from "better-sqlite3";
import { requiredSecret } from "@/lib/security";
import {
  databasePathFromEnvironment,
  initializeDatabase,
} from "../../scripts/database.mjs";

if (process.env.NODE_ENV === "production" && process.env.npm_lifecycle_event !== "build") {
  requiredSecret("ADMIN_USERNAME");
  requiredSecret("ADMIN_PASSWORD");
  requiredSecret("AGENT_TOKEN");
  requiredSecret("SESSION_SECRET");
}

const globalDb = globalThis as unknown as { bookingJcDb?: Database.Database };
export const db =
  globalDb.bookingJcDb ??
  initializeDatabase({
    databasePath: databasePathFromEnvironment(),
  });
if (process.env.NODE_ENV !== "production") globalDb.bookingJcDb = db;

export type Stay = { id: number; name: string; location: string; starts_on: string | null; ends_on: string | null; total_capacity: number; hidden_capacity:number; sofa_capacity:number };
export type StayResource = { id:number; stay_id:number; name:string; capacity:number; priority:number; admin_only:number; requires_sofa_consent:number };
export type RequestAllocation = { request_id:number; resource_id:number; seats:number };
export type InviteKey = { id:number; guest_name:string; code:string; version:number; active:number; use_count:number; last_used_at:string|null; created_at:string };
export type BookingRequest = {
  id: number; stay_id: number; stay_name: string; guest_name: string; contact: string;
  starts_on: string; ends_on: string; party_size: number; accepts_sofa: number; accepts_air_mattress:number;
  note: string; host_note:string; status: string; exclusive:number; manage_token: string; created_at: string; allocation: string | null;
  is_home:number; deleted_at:string|null; tracking_last_accessed_at:string|null; change_id:number|null; change_guest_name:string|null; change_starts_on:string|null; change_ends_on:string|null;
  change_party_size:number|null; change_accepts_sofa:number|null; change_accepts_air_mattress:number|null; change_exclusive:number|null;
  change_note:string|null; change_created_at:string|null;
  conflict_preview?:string|null;
};

export type GuestRequest = Pick<BookingRequest,"id"|"stay_name"|"starts_on"|"ends_on"|"party_size"|"status"|"exclusive"|"allocation">;

export function listRequestsForInvite(inviteKeyId:number):GuestRequest[]{
  return db.prepare(`SELECT q.id,s.name stay_name,q.starts_on,q.ends_on,q.party_size,q.status,q.exclusive,
    GROUP_CONCAT(r.name || ' × ' || a.seats, ', ') allocation
    FROM requests q JOIN stays s ON s.id=q.stay_id
    LEFT JOIN allocations a ON a.request_id=q.id LEFT JOIN resources r ON r.id=a.resource_id
    WHERE q.invite_key_id=? AND q.deleted_at IS NULL GROUP BY q.id ORDER BY q.starts_on DESC,q.created_at DESC`).all(inviteKeyId) as GuestRequest[];
}

export function listStays(): Stay[] {
  return db.prepare(`SELECT s.*, COALESCE(SUM(CASE WHEN r.admin_only=0 THEN r.capacity ELSE 0 END),0) total_capacity,
    COALESCE(SUM(CASE WHEN r.admin_only=1 THEN r.capacity ELSE 0 END),0) hidden_capacity,
    COALESCE(SUM(CASE WHEN r.requires_sofa_consent=1 THEN r.capacity ELSE 0 END),0) sofa_capacity
    FROM stays s LEFT JOIN resources r ON r.stay_id=s.id
    WHERE s.is_public=1 GROUP BY s.id ORDER BY COALESCE(s.starts_on,'0000')`).all() as Stay[];
}

export function listStayResources(): StayResource[] {
  return db.prepare("SELECT id,stay_id,name,capacity,priority,admin_only,requires_sofa_consent FROM resources ORDER BY stay_id,priority,id").all() as StayResource[];
}

export function listRequestAllocations(): RequestAllocation[] {
  return db.prepare(`SELECT a.request_id,a.resource_id,a.seats
    FROM allocations a JOIN resources r ON r.id=a.resource_id
    ORDER BY a.request_id,r.priority,r.id`).all() as RequestAllocation[];
}

export function listInviteKeys(): InviteKey[] {
  return db.prepare("SELECT * FROM invite_keys ORDER BY active DESC, guest_name COLLATE NOCASE, created_at DESC").all() as InviteKey[];
}

export function listRequests(): BookingRequest[] {
  const rows=db.prepare(`SELECT q.*, s.name stay_name, CASE WHEN s.starts_on IS NULL AND s.ends_on IS NULL THEN 1 ELSE 0 END is_home,
    c.id change_id,c.guest_name change_guest_name,c.starts_on change_starts_on,c.ends_on change_ends_on,
    c.party_size change_party_size,c.accepts_sofa change_accepts_sofa,c.accepts_air_mattress change_accepts_air_mattress,
    c.exclusive change_exclusive,c.note change_note,c.created_at change_created_at,
    GROUP_CONCAT(r.name || ' × ' || a.seats, ', ') allocation
    FROM requests q JOIN stays s ON s.id=q.stay_id
    LEFT JOIN allocations a ON a.request_id=q.id LEFT JOIN resources r ON r.id=a.resource_id
    LEFT JOIN request_changes c ON c.request_id=q.id AND c.status='pending'
    WHERE q.deleted_at IS NULL
    GROUP BY q.id ORDER BY CASE q.status WHEN 'pending' THEN 0 ELSE 1 END, q.starts_on, q.created_at`).all() as BookingRequest[];
  return rows.map(request=>({...request,conflict_preview:previewConflict(request)}));
}

function previewConflict(r:BookingRequest):string|null{
  if(r.status!=="pending"&&!r.change_id)return null;
  const start=r.change_starts_on??r.starts_on,end=r.change_ends_on??r.ends_on,size=r.change_party_size??r.party_size;
  const sofa=r.change_accepts_sofa??r.accepts_sofa,hidden=r.change_accepts_air_mattress??r.accepts_air_mattress,exclusive=r.change_exclusive??r.exclusive;
  if(db.prepare("SELECT 1 FROM blackouts WHERE stay_id=? AND starts_on < ? AND ends_on > ? LIMIT 1").get(r.stay_id,end,start))return "blackout";
  const overlaps=db.prepare("SELECT exclusive FROM requests WHERE deleted_at IS NULL AND stay_id=? AND id<>? AND status='approved' AND starts_on < ? AND ends_on > ?").all(r.stay_id,r.id,end,start) as Array<{exclusive:number}>;
  if((exclusive&&overlaps.length)||overlaps.some(x=>x.exclusive))return "exclusive";
  const resources=db.prepare("SELECT id,capacity,admin_only,requires_sofa_consent FROM resources WHERE stay_id=? ORDER BY priority,id").all(r.stay_id) as Array<{id:number;capacity:number;admin_only:number;requires_sofa_consent:number}>;
  let remaining=size;
  for(const resource of resources){if(resource.admin_only&&!hidden||resource.requires_sofa_consent&&!sofa)continue;const used=db.prepare(`SELECT q.starts_on,q.ends_on,a.seats FROM allocations a JOIN requests q ON q.id=a.request_id WHERE q.deleted_at IS NULL AND q.status='approved' AND q.id<>? AND a.resource_id=? AND q.starts_on < ? AND q.ends_on > ?`).all(r.id,resource.id,end,start) as Array<{starts_on:string;ends_on:string;seats:number}>;let peak=0;for(let day=start;day<end;day=new Date(Date.parse(day+"T00:00:00Z")+86400000).toISOString().slice(0,10))peak=Math.max(peak,used.filter(x=>x.starts_on<=day&&x.ends_on>day).reduce((sum,x)=>sum+x.seats,0));remaining-=Math.min(remaining,Math.max(0,resource.capacity-peak));}
  return remaining>0?"capacity":"clear";
}

export function publicSchedule() {
  return db.prepare(`SELECT q.id, q.stay_id, q.guest_name, q.starts_on, q.ends_on, q.party_size, q.status, q.exclusive,
    COALESCE(SUM(CASE WHEN r.admin_only=0 THEN a.seats ELSE 0 END),0) public_seats,
    COALESCE(SUM(CASE WHEN r.admin_only=1 THEN a.seats ELSE 0 END),0) hidden_seats,
    GROUP_CONCAT(r.name || ' × ' || a.seats, ', ') allocation
    FROM requests q LEFT JOIN allocations a ON a.request_id=q.id LEFT JOIN resources r ON r.id=a.resource_id
    WHERE q.deleted_at IS NULL AND q.status IN ('approved','pending') GROUP BY q.id ORDER BY q.starts_on`).all() as Array<{
      id:number; stay_id:number; guest_name:string; starts_on:string; ends_on:string; party_size:number; status:string; exclusive:number; public_seats:number; hidden_seats:number; allocation:string|null
    }>;
}

export type Blackout={id:number;stay_id:number;stay_name:string;starts_on:string;ends_on:string;reason:string};
export function listBlackouts():Blackout[]{return db.prepare(`SELECT b.*,s.name stay_name FROM blackouts b JOIN stays s ON s.id=b.stay_id ORDER BY b.starts_on`).all() as Blackout[];}
export function getSetting(key:string){return (db.prepare("SELECT value FROM settings WHERE key=?").get(key) as {value:string}|undefined)?.value;}

export type AuditLog={id:number;action:string;entity_type:string;entity_id:number|null;summary:string;created_at:string};
export function addAuditLog(action:string,entityType:string,entityId:number|null,summary=""){
  db.prepare("INSERT INTO audit_logs (action,entity_type,entity_id,summary) VALUES (?,?,?,?)").run(action,entityType,entityId,summary.slice(0,240));
}
export function listAuditLogs(limit=80):AuditLog[]{return db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?").all(limit) as AuditLog[];}
export function listDeletedRequests():BookingRequest[]{return db.prepare(`SELECT q.*,s.name stay_name,CASE WHEN s.starts_on IS NULL AND s.ends_on IS NULL THEN 1 ELSE 0 END is_home,
  NULL allocation,NULL change_id,NULL change_guest_name,NULL change_starts_on,NULL change_ends_on,NULL change_party_size,NULL change_accepts_sofa,NULL change_accepts_air_mattress,NULL change_exclusive,NULL change_note,NULL change_created_at
  FROM requests q JOIN stays s ON s.id=q.stay_id WHERE q.deleted_at IS NOT NULL ORDER BY q.deleted_at DESC`).all() as BookingRequest[];}
