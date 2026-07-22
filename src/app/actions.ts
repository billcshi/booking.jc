"use server";

import { randomBytes, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addAuditLog, db, getSetting } from "@/lib/db";
import { clearAdminSession, clearGroupSession, createAdminSession, createGroupSession, createInviteSession, getGroupAccess, isAdmin } from "@/lib/auth";
import { rateLimit, requiredSecret, validIsoDate } from "@/lib/security";
import { reviewRequestChangeInTransaction } from "../../scripts/request-change-transaction.mjs";
import { cancelTrackedRequestInTransaction } from "../../scripts/tracking-transactions.mjs";
import { permanentlyDeleteTrashedRequestInTransaction } from "../../scripts/trash-transactions.mjs";

function text(form: FormData, name: string, max = 200) { const value=String(form.get(name) ?? "").trim(); return value.length<=max ? value : ""; }
function same(a:string,b:string) { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
async function requireAdmin() { if (!(await isAdmin())) redirect("/admin/login"); }
function nightsBetween(start:string,end:string) { return Math.round((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86_400_000); }
function addDay(date:string,days:number) { return new Date(Date.parse(`${date}T00:00:00Z`)+days*86_400_000).toISOString().slice(0,10); }
function validSubmissionKey(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)}
function peakAllocatedSeats(resourceId:number) {
  const allocations=db.prepare(`SELECT q.starts_on,q.ends_on,a.seats FROM allocations a JOIN requests q ON q.id=a.request_id
    WHERE a.resource_id=? AND q.deleted_at IS NULL AND q.status='approved'`).all(resourceId) as Array<{starts_on:string;ends_on:string;seats:number}>;
  const daily=new Map<string,number>();
  for(const allocation of allocations)for(let night=0;night<nightsBetween(allocation.starts_on,allocation.ends_on);night++){
    const day=addDay(allocation.starts_on,night);daily.set(day,(daily.get(day)??0)+allocation.seats);
  }
  return Math.max(0,...daily.values());
}

export async function submitRequest(form: FormData) {
  if (!(await rateLimit("request", 12))) redirect("/?error=rate");
  const access=await getGroupAccess();
  if (!access) redirect("/?error=locked");
  const stayId=Number(text(form,"stay_id",20)), guest=access.guestName??text(form,"guest_name",80);
  const start=text(form,"starts_on"), end=text(form,"ends_on"), size=Number(text(form,"party_size"));
  const submissionKey=text(form,"submission_key",64);
  if (!guest || !validIsoDate(start) || !validIsoDate(end) || start>=end || nightsBetween(start,end)>90 || !Number.isInteger(size) || size<1 || size>8 || !validSubmissionKey(submissionKey)) redirect("/?error=form");
  let token=randomBytes(24).toString("base64url");
  const tx=db.transaction(()=>{
    const stay=db.prepare("SELECT starts_on,ends_on FROM stays WHERE id=? AND is_public=1").get(stayId) as {starts_on:string|null;ends_on:string|null}|undefined;
    if (!stay || (stay.starts_on && start<stay.starts_on) || (stay.ends_on && end>stay.ends_on))throw new Error("dates");
    if(db.prepare("SELECT id FROM blackouts WHERE stay_id=? AND starts_on < ? AND ends_on > ? LIMIT 1").get(stayId,end,start))throw new Error("blocked");
    const isHome=!stay.starts_on&&!stay.ends_on;
    const result=db.prepare(`INSERT INTO requests (stay_id,guest_name,contact,starts_on,ends_on,party_size,accepts_sofa,accepts_air_mattress,note,manage_token,exclusive,invite_key_id,submission_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).run(stayId,guest,"",start,end,size,isHome&&form.get("accepts_sofa")?1:0,isHome&&form.get("accepts_air_mattress")?1:0,text(form,"note",1000),token,form.get("exclusive")?1:0,access.inviteKeyId,submissionKey);
    if(!result.changes)token=(db.prepare("SELECT manage_token FROM requests WHERE submission_key=?").get(submissionKey) as {manage_token:string}).manage_token;
  });
  try{tx.immediate();}catch(error){if(error instanceof Error&&["dates","blocked"].includes(error.message))redirect(`/?error=${error.message}`);throw error;}
  revalidatePath("/");
  redirect(`/request/${token}?created=1`);
}

export async function unlockGroup(form:FormData) {
  if(!(await rateLimit("unlock",10))) redirect("/?error=rate");
  const key=text(form,"key",100);
  const groupKey=getSetting("group_key");
  if(groupKey&&same(key,groupKey)){await createGroupSession();redirect("/?unlocked=1")}
  const invite=db.prepare("SELECT id,version FROM invite_keys WHERE code=? AND active=1").get(key) as {id:number;version:number}|undefined;
  if(!invite)redirect("/?error=key");
  db.prepare("UPDATE invite_keys SET use_count=use_count+1,last_used_at=CURRENT_TIMESTAMP WHERE id=?").run(invite.id);
  await createInviteSession(invite.id,invite.version); redirect("/?unlocked=1");
}

export async function login(form: FormData) {
  if (!(await rateLimit("login", 5))) redirect("/admin/login?error=rate");
  const user=text(form,"username"), pass=text(form,"password");
  if (!same(user,requiredSecret("ADMIN_USERNAME")) || !same(pass,requiredSecret("ADMIN_PASSWORD"))) redirect("/admin/login?error=1");
  await createAdminSession(); redirect("/admin");
}
export async function logout() { await clearAdminSession(); redirect("/"); }
export async function switchKey(){await clearGroupSession();redirect("/?change_key=1");}

function suggestAllocation(requestId:number) {
  const req=db.prepare("SELECT * FROM requests WHERE id=?").get(requestId) as {stay_id:number;starts_on:string;ends_on:string;party_size:number;accepts_sofa:number;accepts_air_mattress:number;exclusive:number};
  const overlaps=db.prepare("SELECT exclusive FROM requests WHERE deleted_at IS NULL AND stay_id=? AND id<>? AND status='approved' AND starts_on < ? AND ends_on > ?").all(req.stay_id,requestId,req.ends_on,req.starts_on) as Array<{exclusive:number}>;
  if((req.exclusive&&overlaps.length>0)||overlaps.some(x=>x.exclusive))return false;
  const resources=db.prepare(`SELECT * FROM resources WHERE stay_id=? ORDER BY priority, capacity DESC`).all(req.stay_id) as Array<{id:number;name:string;capacity:number;admin_only:number;requires_sofa_consent:number}>;
  let remaining=req.party_size;
  for (const resource of resources) {
    if (resource.requires_sofa_consent && !req.accepts_sofa) continue;
    if (resource.admin_only && !req.accepts_air_mattress) continue;
    const existing=db.prepare(`SELECT q.starts_on, q.ends_on, a.seats FROM allocations a JOIN requests q ON q.id=a.request_id
      WHERE a.resource_id=? AND q.deleted_at IS NULL AND q.status='approved' AND q.starts_on < ? AND q.ends_on > ?`).all(resource.id,req.ends_on,req.starts_on) as Array<{starts_on:string;ends_on:string;seats:number}>;
    let peak=0;
    for(let night=0;night<nightsBetween(req.starts_on,req.ends_on);night++) { const day=addDay(req.starts_on,night); peak=Math.max(peak,existing.filter(x=>x.starts_on<=day&&x.ends_on>day).reduce((sum,x)=>sum+x.seats,0)); }
    const seats=Math.min(remaining, Math.max(0,resource.capacity-peak));
    if (seats>0) { db.prepare("INSERT INTO allocations (request_id,resource_id,seats) VALUES (?,?,?)").run(requestId,resource.id,seats); remaining-=seats; }
    if (!remaining) break;
  }
  return remaining===0;
}

type ManualAllocation = { resourceId: number; seats: number };

function assignManualAllocation(
  requestId: number,
  allocations: ManualAllocation[],
): "ok" | "allocation" | "capacity" {
  const request = db.prepare("SELECT * FROM requests WHERE id=?").get(requestId) as {
    stay_id: number;
    starts_on: string;
    ends_on: string;
    party_size: number;
    accepts_sofa: number;
    accepts_air_mattress: number;
    exclusive: number;
  };
  if (allocations.reduce((sum, allocation) => sum + allocation.seats, 0) !== request.party_size) {
    return "allocation";
  }
  const overlaps = db.prepare(`SELECT exclusive FROM requests
    WHERE stay_id=? AND id<>? AND status='approved' AND starts_on < ? AND ends_on > ?`).all(
      request.stay_id,
      requestId,
      request.ends_on,
      request.starts_on,
    ) as Array<{ exclusive: number }>;
  if ((request.exclusive && overlaps.length > 0) || overlaps.some((row) => row.exclusive)) {
    return "capacity";
  }
  for (const allocation of allocations) {
    const resource = db.prepare(`SELECT id,stay_id,capacity,admin_only,requires_sofa_consent
      FROM resources WHERE id=?`).get(allocation.resourceId) as {
        id: number;
        stay_id: number;
        capacity: number;
        admin_only: number;
        requires_sofa_consent: number;
      } | undefined;
    if (
      !resource ||
      resource.stay_id !== request.stay_id ||
      (resource.requires_sofa_consent && !request.accepts_sofa) ||
      (resource.admin_only && !request.accepts_air_mattress)
    ) {
      return "allocation";
    }
    const existing = db.prepare(`SELECT q.starts_on,q.ends_on,a.seats
      FROM allocations a JOIN requests q ON q.id=a.request_id
      WHERE a.resource_id=? AND q.status='approved' AND q.id<>?
        AND q.starts_on < ? AND q.ends_on > ?`).all(
          resource.id,
          requestId,
          request.ends_on,
          request.starts_on,
        ) as Array<{ starts_on: string; ends_on: string; seats: number }>;
    let peak = 0;
    for (let night = 0; night < nightsBetween(request.starts_on, request.ends_on); night++) {
      const day = addDay(request.starts_on, night);
      peak = Math.max(
        peak,
        existing
          .filter((row) => row.starts_on <= day && row.ends_on > day)
          .reduce((sum, row) => sum + row.seats, 0),
      );
    }
    if (allocation.seats > resource.capacity - peak) return "capacity";
  }
  const insert = db.prepare(
    "INSERT INTO allocations (request_id,resource_id,seats) VALUES (?,?,?)",
  );
  for (const allocation of allocations) {
    insert.run(requestId, allocation.resourceId, allocation.seats);
  }
  return "ok";
}

export async function updateRequest(form: FormData) {
  await requireAdmin(); const id=Number(text(form,"id")), status=text(form,"status");
  if (!["approved","rejected","cancelled","pending"].includes(status)) return;
  const tx=db.transaction(()=>{
    const request=db.prepare(`SELECT q.stay_id,q.starts_on,q.ends_on,
      s.starts_on stay_starts_on,s.ends_on stay_ends_on
      FROM requests q JOIN stays s ON s.id=q.stay_id WHERE q.id=?`).get(id) as {stay_id:number;starts_on:string;ends_on:string;stay_starts_on:string|null;stay_ends_on:string|null}|undefined;
    if(!request)throw new Error("form");
    if(status==="approved"&&((request.stay_starts_on&&request.starts_on<request.stay_starts_on)||(request.stay_ends_on&&request.ends_on>request.stay_ends_on)))throw new Error("request_bounds");
    if(status==="approved"&&db.prepare("SELECT 1 FROM blackouts WHERE stay_id=? AND starts_on < ? AND ends_on > ? LIMIT 1").get(request.stay_id,request.ends_on,request.starts_on))throw new Error("blocked");
    db.prepare("DELETE FROM allocations WHERE request_id=?").run(id);
    if (status==="approved" && !suggestAllocation(id)) throw new Error("capacity");
    db.prepare("UPDATE requests SET status=? WHERE id=?").run(status,id);
    if(status!=="approved")db.prepare("UPDATE request_changes SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='pending'").run(id);
    addAuditLog(`request.${status}`,"request",id);
  });
  try { tx.immediate(); } catch(error) { if(error instanceof Error&&["blocked","form","request_bounds"].includes(error.message))redirect(`/admin?error=${error.message}`);if(error instanceof Error&&error.message==="capacity")redirect("/admin?error=capacity");throw error; }
  revalidatePath("/"); revalidatePath("/admin"); redirect("/admin");
}

export async function editRequest(form: FormData) {
  await requireAdmin();
  const id = Number(text(form, "id", 20));
  const guest = text(form, "guest_name", 80);
  const start = text(form, "starts_on");
  const end = text(form, "ends_on");
  const size = Number(text(form, "party_size"));
  const status = text(form, "status", 20);
  const allocationMode = text(form, "allocation_mode", 20);
  if (!guest) redirect("/admin?error=name");
  if (!validIsoDate(start) || !validIsoDate(end) || start >= end) {
    redirect("/admin?error=dates");
  }
  if (nightsBetween(start, end) > 3650) redirect("/admin?error=range");
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 8 ||
    !["pending", "approved", "rejected", "cancelled"].includes(status)
  ) {
    redirect("/admin?error=people");
  }
  if (!["auto", "manual"].includes(allocationMode)) redirect("/admin?error=allocation");
  const rawResourceIds = form.getAll("allocation_resource_id").map(String);
  const rawSeats = form.getAll("allocation_seats").map(String);
  if (rawResourceIds.length !== rawSeats.length || rawResourceIds.length > 30) {
    redirect("/admin?error=allocation");
  }
  const submittedAllocations = rawResourceIds.map((rawId, index) => ({
    resourceId: /^\d+$/.test(rawId) ? Number(rawId) : NaN,
    seats: Number(rawSeats[index]),
  }));
  if (
    submittedAllocations.some(
      (allocation) =>
        !Number.isInteger(allocation.resourceId) ||
        allocation.resourceId < 1 ||
        !Number.isInteger(allocation.seats) ||
        allocation.seats < 0 ||
        allocation.seats > 8,
    ) ||
    new Set(submittedAllocations.map((allocation) => allocation.resourceId)).size !==
      submittedAllocations.length
  ) {
    redirect("/admin?error=allocation");
  }
  const manualAllocations = submittedAllocations.filter((allocation) => allocation.seats > 0);
  const tx = db.transaction(() => {
    const current = db.prepare(`SELECT q.stay_id,s.starts_on stay_starts_on,s.ends_on stay_ends_on
      FROM requests q JOIN stays s ON s.id=q.stay_id WHERE q.id=?`).get(id) as {
        stay_id: number;
        stay_starts_on: string | null;
        stay_ends_on: string | null;
      } | undefined;
    if (!current) throw new Error("form");
    if (
      (current.stay_starts_on && start < current.stay_starts_on) ||
      (current.stay_ends_on && end > current.stay_ends_on)
    ) {
      throw new Error("dates");
    }
    if (
      status === "approved" &&
      db.prepare(`SELECT id FROM blackouts
        WHERE stay_id=? AND starts_on < ? AND ends_on > ? LIMIT 1`).get(
          current.stay_id,
          end,
          start,
        )
    ) {
      throw new Error("blocked");
    }
    const isHome = !current.stay_starts_on && !current.stay_ends_on;
    db.prepare("DELETE FROM allocations WHERE request_id=?").run(id);
    db.prepare(`UPDATE requests SET guest_name=?,starts_on=?,ends_on=?,party_size=?,
      accepts_sofa=?,accepts_air_mattress=?,exclusive=?,note=?,host_note=?,status=? WHERE id=?`).run(
        guest,
        start,
        end,
        size,
        isHome && form.get("accepts_sofa") ? 1 : 0,
        isHome && form.get("accepts_air_mattress") ? 1 : 0,
        form.get("exclusive") ? 1 : 0,
        text(form, "note", 1000),
        text(form, "host_note", 1000),
        status,
        id,
      );
    db.prepare("UPDATE request_changes SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='pending'").run(id);
    if (status === "approved") {
      if (allocationMode === "auto") {
        if (!suggestAllocation(id)) throw new Error("capacity");
      } else {
        const result = assignManualAllocation(id, manualAllocations);
        if (result !== "ok") throw new Error(result);
      }
    }
    addAuditLog("request.edited","request",id);
  });
  try {
    tx.immediate();
  } catch (error) {
    if (error instanceof Error && ["allocation", "blocked", "dates", "form"].includes(error.message)) {
      redirect(`/admin?error=${error.message}`);
    }
    if (error instanceof Error && error.message === "capacity") {
      redirect("/admin?error=capacity");
    }
    throw error;
  }
  revalidatePath("/");
  revalidatePath("/admin");
  redirect("/admin?edited=1");
}

export async function deleteRequest(form:FormData){await requireAdmin();const id=Number(text(form,"id",20));const tx=db.transaction(()=>{db.prepare("DELETE FROM allocations WHERE request_id=?").run(id);db.prepare("UPDATE request_changes SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='pending'").run(id);db.prepare("UPDATE requests SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL").run(id);addAuditLog("request.trashed","request",id)});tx();revalidatePath("/");revalidatePath("/admin");redirect("/admin?request_deleted=1")}

export async function restoreRequest(form:FormData){await requireAdmin();const id=Number(text(form,"id",20));const tx=db.transaction(()=>{const request=db.prepare("SELECT stay_id,starts_on,ends_on,status FROM requests WHERE id=? AND deleted_at IS NOT NULL").get(id) as {stay_id:number;starts_on:string;ends_on:string;status:string}|undefined;if(!request)throw new Error("form");if(request.status==="approved"&&db.prepare("SELECT 1 FROM blackouts WHERE stay_id=? AND starts_on < ? AND ends_on > ? LIMIT 1").get(request.stay_id,request.ends_on,request.starts_on))throw new Error("blocked");db.prepare("UPDATE requests SET deleted_at=NULL WHERE id=?").run(id);if(request.status==="approved"&&!suggestAllocation(id))throw new Error("capacity");addAuditLog("request.restored","request",id)});try{tx.immediate()}catch(error){if(error instanceof Error&&["form","capacity","blocked"].includes(error.message))redirect(`/admin?error=${error.message}`);throw error}revalidatePath("/");revalidatePath("/admin");redirect("/admin?restored=1")}

export async function permanentlyDeleteRequest(form:FormData){await requireAdmin();const id=Number(text(form,"id",20));try{permanentlyDeleteTrashedRequestInTransaction({db,requestId:id,audit:(requestId:number)=>addAuditLog("request.permanently_deleted","request",requestId)})}catch(error){if(error instanceof Error&&error.message==="form")redirect("/admin?error=form");throw error}revalidatePath("/");revalidatePath("/admin");redirect("/admin?permanently_deleted=1")}

export async function rotateTrackingToken(form:FormData){await requireAdmin();const id=Number(text(form,"id",20)),token=randomBytes(24).toString("base64url");db.transaction(()=>{const result=db.prepare("UPDATE requests SET manage_token=?,tracking_last_accessed_at=NULL WHERE id=? AND deleted_at IS NULL").run(token,id);if(result.changes)addAuditLog("tracking.rotated","request",id)}) .immediate();revalidatePath("/admin");redirect("/admin?tracking_rotated=1")}

export async function resetCalendarFeed(){await requireAdmin();db.transaction(()=>{db.prepare("UPDATE settings SET value=? WHERE key='calendar_feed_token'").run(randomBytes(24).toString("base64url"));addAuditLog("calendar_feed.rotated","setting",null)}) .immediate();revalidatePath("/admin");redirect("/admin?feed_rotated=1")}

export async function createStay(form: FormData) {
  await requireAdmin(); const name=text(form,"name",100), location=text(form,"location",120);
  if (!name || !location) return;
  const start=text(form,"starts_on")||null, end=text(form,"ends_on")||null;
  if (!start || !end || !validIsoDate(start) || !validIsoDate(end) || start>=end) return;
  const lines=text(form,"resources",2000).split("\n").map(x=>x.trim()).filter(Boolean).slice(0,30);
  if (!lines.length) return;
  const tx=db.transaction(()=>{
    const home=form.get("block_home")?db.prepare("SELECT id FROM stays WHERE starts_on IS NULL ORDER BY id LIMIT 1").get() as {id:number}|undefined:undefined;
    if(home&&db.prepare("SELECT id FROM requests WHERE deleted_at IS NULL AND stay_id=? AND status='approved' AND starts_on < ? AND ends_on > ? LIMIT 1").get(home.id,end,start))throw new Error("conflict");
    const id=Number(db.prepare("INSERT INTO stays (name,location,starts_on,ends_on) VALUES (?,?,?,?)").run(name,location,start,end).lastInsertRowid);
    lines.forEach((line,i)=>{ const [rawResource,cap]=line.split("|").map(x=>x.trim()); const resource=rawResource.slice(0,100); const parsed=Number(cap); const capacity=Number.isInteger(parsed)&&parsed>=1&&parsed<=8?parsed:1; if(!resource) throw new Error("Invalid resource"); db.prepare("INSERT INTO resources (stay_id,name,capacity,priority) VALUES (?,?,?,?)").run(id,resource,capacity,i+1); });
    if(home)db.prepare("INSERT INTO blackouts (stay_id,starts_on,ends_on,reason) VALUES (?,?,?,?)").run(home.id,start,end,`外出：${name}`);
    addAuditLog("stay.created","stay",id);
  });
  try{tx.immediate();}catch(error){if(error instanceof Error&&error.message==="conflict")redirect("/admin?error=conflict");throw error;}
  revalidatePath("/"); redirect("/admin");
}

export async function editStay(form:FormData) {
  await requireAdmin();
  const stayId=Number(text(form,"stay_id",20)),name=text(form,"name",100),location=text(form,"location",120);
  const start=text(form,"starts_on"),end=text(form,"ends_on");
  if(!name||!location||!validIsoDate(start)||!validIsoDate(end)||start>=end)redirect("/admin?error=trip_form");
  const lines=text(form,"resources",2000).split("\n").map(x=>x.trim()).filter(Boolean).slice(0,30);
  const parsed=lines.map((line,index)=>{const [raw,cap]=line.split("|").map(x=>x.trim());const capacity=Number(cap);return {name:raw?.slice(0,100)??"",capacity,priority:index+1};});
  if(!parsed.length||parsed.some(r=>!r.name||!Number.isInteger(r.capacity)||r.capacity<1||r.capacity>8))redirect("/admin?error=trip_resources");
  const tx=db.transaction(()=>{
    const stay=db.prepare("SELECT id,name,starts_on,ends_on FROM stays WHERE id=?").get(stayId) as {id:number;name:string;starts_on:string|null;ends_on:string|null}|undefined;
    if(!stay||!stay.starts_on||!stay.ends_on)throw new Error("trip_form");
    const activeBounds=db.prepare("SELECT MIN(starts_on) first_night,MAX(ends_on) last_departure FROM requests WHERE deleted_at IS NULL AND stay_id=? AND status IN ('pending','approved')").get(stayId) as {first_night:string|null;last_departure:string|null};
    if((activeBounds.first_night&&start>activeBounds.first_night)||(activeBounds.last_departure&&end<activeBounds.last_departure))throw new Error("trip_dates");
    const blackoutBounds=db.prepare("SELECT MIN(starts_on) first_night,MAX(ends_on) last_departure FROM blackouts WHERE stay_id=?").get(stayId) as {first_night:string|null;last_departure:string|null};
    if((blackoutBounds.first_night&&start>blackoutBounds.first_night)||(blackoutBounds.last_departure&&end<blackoutBounds.last_departure))throw new Error("trip_dates");
    const existing=db.prepare("SELECT id,name,capacity,priority FROM resources WHERE stay_id=? ORDER BY priority,id").all(stayId) as Array<{id:number;name:string;capacity:number;priority:number}>;
    for(let i=0;i<Math.min(existing.length,parsed.length);i++)if(parsed[i].capacity<peakAllocatedSeats(existing[i].id))throw new Error("trip_capacity");
    for(const resource of existing.slice(parsed.length))if(db.prepare("SELECT 1 FROM allocations WHERE resource_id=? LIMIT 1").get(resource.id))throw new Error("trip_capacity");
    const linkedHomeBlock=db.prepare("SELECT id,stay_id FROM blackouts WHERE starts_on=? AND ends_on=? AND reason=? LIMIT 1").get(stay.starts_on,stay.ends_on,`外出：${stay.name}`) as {id:number;stay_id:number}|undefined;
    if(linkedHomeBlock&&db.prepare("SELECT 1 FROM requests WHERE deleted_at IS NULL AND stay_id=? AND status='approved' AND starts_on < ? AND ends_on > ? LIMIT 1").get(linkedHomeBlock.stay_id,end,start))throw new Error("conflict");
    db.prepare("UPDATE stays SET name=?,location=?,starts_on=?,ends_on=? WHERE id=?").run(name,location,start,end,stayId);
    parsed.forEach((resource,index)=>{const prior=existing[index];if(prior)db.prepare("UPDATE resources SET name=?,capacity=?,priority=? WHERE id=?").run(resource.name,resource.capacity,resource.priority,prior.id);else db.prepare("INSERT INTO resources (stay_id,name,capacity,priority) VALUES (?,?,?,?)").run(stayId,resource.name,resource.capacity,resource.priority);});
    for(const resource of existing.slice(parsed.length))db.prepare("DELETE FROM resources WHERE id=?").run(resource.id);
    if(linkedHomeBlock)db.prepare("UPDATE blackouts SET starts_on=?,ends_on=?,reason=? WHERE id=?").run(start,end,`外出：${name}`,linkedHomeBlock.id);
    addAuditLog("stay.edited","stay",stayId);
  });
  try{tx.immediate();}catch(error){if(error instanceof Error&&["trip_form","trip_dates","trip_capacity","conflict"].includes(error.message))redirect(`/admin?error=${error.message}`);throw error;}
  revalidatePath("/");revalidatePath("/admin");redirect("/admin?stay_edited=1");
}

export async function editHome(form:FormData) {
  await requireAdmin();
  const stayId=Number(text(form,"stay_id",20)),name=text(form,"name",100),location=text(form,"location",120),hostDisplayName=text(form,"host_display_name",40);
  if(!Number.isInteger(stayId)||!name||!location||!hostDisplayName)redirect("/admin?error=home_form");
  const stay=db.prepare("SELECT id FROM stays WHERE id=? AND starts_on IS NULL AND ends_on IS NULL").get(stayId) as {id:number}|undefined;
  if(!stay)redirect("/admin?error=home_form");
  const rawIds=form.getAll("resource_id").map(String),rawNames=form.getAll("resource_name").map(String),rawCapacities=form.getAll("resource_capacity").map(String),rawAdminOnly=form.getAll("resource_admin_only").map(String),rawSofaConsent=form.getAll("resource_sofa_consent").map(String);
  const count=rawIds.length;
  if(!count||count>30||[rawNames,rawCapacities,rawAdminOnly,rawSofaConsent].some(values=>values.length!==count))redirect("/admin?error=home_resources");
  const parsed=rawIds.map((rawId,index)=>{const resourceName=rawNames[index].trim(),capacity=Number(rawCapacities[index]),adminOnly=Number(rawAdminOnly[index]),requiresSofaConsent=Number(rawSofaConsent[index]);const id=rawId?/^\d+$/.test(rawId)?Number(rawId):NaN:null;return{id,name:resourceName,capacity,adminOnly,requiresSofaConsent,priority:index+1};});
  if(parsed.some(resource=>resource.id!==null&&!Number.isInteger(resource.id)||!resource.name||resource.name.length>100||!Number.isInteger(resource.capacity)||resource.capacity<1||resource.capacity>8||![0,1].includes(resource.adminOnly)||![0,1].includes(resource.requiresSofaConsent))||!parsed.some(resource=>resource.adminOnly===0))redirect("/admin?error=home_resources");
  const tx=db.transaction(()=>{
    const existing=db.prepare("SELECT id FROM resources WHERE stay_id=? ORDER BY priority,id").all(stayId) as Array<{id:number}>;
    const existingIds=new Set(existing.map(resource=>resource.id)),submittedIds=parsed.flatMap(resource=>resource.id===null?[]:[resource.id]);
    if(new Set(submittedIds).size!==submittedIds.length||submittedIds.some(id=>!existingIds.has(id)))throw new Error("home_resources");
    for(const resource of parsed){if(resource.id!==null&&resource.capacity<peakAllocatedSeats(resource.id))throw new Error("home_capacity");}
    for(const resource of existing){if(!submittedIds.includes(resource.id)&&db.prepare("SELECT 1 FROM allocations WHERE resource_id=? LIMIT 1").get(resource.id))throw new Error("home_capacity");}
    db.prepare("UPDATE stays SET name=?,location=? WHERE id=?").run(name,location,stayId);
    db.prepare("INSERT INTO settings (key,value) VALUES ('host_display_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(hostDisplayName);
    for(const resource of parsed){if(resource.id===null)db.prepare("INSERT INTO resources (stay_id,name,capacity,priority,admin_only,requires_sofa_consent) VALUES (?,?,?,?,?,?)").run(stayId,resource.name,resource.capacity,resource.priority,resource.adminOnly,resource.requiresSofaConsent);else db.prepare("UPDATE resources SET name=?,capacity=?,priority=?,admin_only=?,requires_sofa_consent=? WHERE id=? AND stay_id=?").run(resource.name,resource.capacity,resource.priority,resource.adminOnly,resource.requiresSofaConsent,resource.id,stayId);}
    for(const resource of existing){if(!submittedIds.includes(resource.id))db.prepare("DELETE FROM resources WHERE id=? AND stay_id=?").run(resource.id,stayId);}
    addAuditLog("home.edited","stay",stayId);
  });
  try{tx.immediate();}catch(error){if(error instanceof Error&&error.message==="home_resources")redirect("/admin?error=home_resources");if(error instanceof Error&&error.message==="home_capacity")redirect("/admin?error=home_capacity");throw error;}
  revalidatePath("/");revalidatePath("/admin");redirect("/admin?home_updated=1");
}

export async function deleteStay(form:FormData) {
  await requireAdmin();
  const stayId=Number(text(form,"stay_id",20));
  const tx=db.transaction(()=>{
    const stay=db.prepare("SELECT id,name,starts_on,ends_on FROM stays WHERE id=?").get(stayId) as {id:number;name:string;starts_on:string|null;ends_on:string|null}|undefined;
    if(!stay||!stay.starts_on||!stay.ends_on)throw new Error("trip_form");
    if(db.prepare("SELECT 1 FROM requests WHERE deleted_at IS NULL AND stay_id=? AND status IN ('pending','approved') LIMIT 1").get(stayId))throw new Error("trip_active");
    const linkedHomeBlock=db.prepare("SELECT id FROM blackouts WHERE starts_on=? AND ends_on=? AND reason=? LIMIT 1").get(stay.starts_on,stay.ends_on,`外出：${stay.name}`) as {id:number}|undefined;
    if(linkedHomeBlock)db.prepare("DELETE FROM blackouts WHERE id=?").run(linkedHomeBlock.id);
    db.prepare("DELETE FROM stays WHERE id=?").run(stayId);
    addAuditLog("stay.deleted","stay",stayId);
  });
  try{tx.immediate();}catch(error){if(error instanceof Error&&["trip_form","trip_active"].includes(error.message))redirect(`/admin?error=${error.message}`);throw error;}
  revalidatePath("/");revalidatePath("/admin");redirect("/admin?stay_deleted=1");
}

export async function addGuestDirectly(form: FormData) {
  await requireAdmin();
  const stayId=Number(text(form,"stay_id",20)), guest=text(form,"guest_name",80);
  const start=text(form,"starts_on"), end=text(form,"ends_on"), size=Number(text(form,"party_size"));
  const submissionKey=text(form,"submission_key",64);
  if (!guest) redirect("/admin?error=name");
  if (!validIsoDate(start) || !validIsoDate(end) || start>=end) redirect("/admin?error=dates");
  if (nightsBetween(start,end)>3650) redirect("/admin?error=range");
  if (!Number.isInteger(size) || size<1 || size>8) redirect("/admin?error=people");
  if(!validSubmissionKey(submissionKey))redirect("/admin?error=form");
  const token=randomBytes(24).toString("base64url");
  const tx=db.transaction(()=>{
    const stay=db.prepare("SELECT starts_on,ends_on FROM stays WHERE id=?").get(stayId) as {starts_on:string|null;ends_on:string|null}|undefined;
    if (!stay || (stay.starts_on&&start<stay.starts_on) || (stay.ends_on&&end>stay.ends_on)) throw new Error("form");
    if(db.prepare("SELECT id FROM blackouts WHERE stay_id=? AND starts_on < ? AND ends_on > ? LIMIT 1").get(stayId,end,start))throw new Error("blocked");
    const isHome=!stay.starts_on&&!stay.ends_on;
    const inserted=db.prepare(`INSERT INTO requests (stay_id,guest_name,contact,starts_on,ends_on,party_size,accepts_sofa,accepts_air_mattress,host_note,status,manage_token,exclusive,submission_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).run(stayId,guest,"",start,end,size,isHome&&form.get("accepts_sofa")?1:0,isHome&&form.get("accepts_air_mattress")?1:0,text(form,"note",500),"pending",token,form.get("exclusive")?1:0,submissionKey);
    if(!inserted.changes)return;
    const id=Number(inserted.lastInsertRowid);
    if(!suggestAllocation(id)) throw new Error("capacity");
    db.prepare("UPDATE requests SET status='approved' WHERE id=?").run(id);
    addAuditLog("request.created_directly","request",id);
  });
  try{tx.immediate();}catch(error){if(error instanceof Error&&["form","blocked"].includes(error.message))redirect(`/admin?error=${error.message}`);if(error instanceof Error&&error.message==="capacity")redirect("/admin?error=capacity");throw error;}
  revalidatePath("/"); revalidatePath("/admin"); redirect("/admin?added=1");
}

export async function createBlackout(form:FormData){await requireAdmin();const stayId=Number(text(form,"stay_id",20)),start=text(form,"starts_on"),end=text(form,"ends_on"),reason=text(form,"reason",120)||"Host unavailable";if(!validIsoDate(start)||!validIsoDate(end)||start>=end)redirect("/admin?error=form");const tx=db.transaction(()=>{if(db.prepare("SELECT id FROM requests WHERE deleted_at IS NULL AND stay_id=? AND status='approved' AND starts_on < ? AND ends_on > ? LIMIT 1").get(stayId,end,start))throw new Error("conflict");const id=Number(db.prepare("INSERT INTO blackouts (stay_id,starts_on,ends_on,reason) VALUES (?,?,?,?)").run(stayId,start,end,reason).lastInsertRowid);addAuditLog("blackout.created","blackout",id);});try{tx.immediate();}catch(error){if(error instanceof Error&&error.message==="conflict")redirect("/admin?error=conflict");throw error;}revalidatePath("/");revalidatePath("/admin");redirect("/admin?blocked=1")}
export async function removeBlackout(form:FormData){await requireAdmin();const id=Number(text(form,"id",20));db.transaction(()=>{const result=db.prepare("DELETE FROM blackouts WHERE id=?").run(id);if(result.changes)addAuditLog("blackout.deleted","blackout",id)}) .immediate();revalidatePath("/");revalidatePath("/admin");redirect("/admin")}
function validKeyCode(code:string){return /^[A-Za-z0-9._-]{4,64}$/.test(code)}
function keyCodeTaken(code:string,exceptInviteId?:number){if(code===getSetting("group_key"))return true;return Boolean(db.prepare("SELECT 1 FROM invite_keys WHERE code=? AND id<>? LIMIT 1").get(code,exceptInviteId??-1))}
export async function resetGroupKey(form:FormData){await requireAdmin();const next=text(form,"code",64);if(!validKeyCode(next))redirect("/admin?error=key_format");if(db.prepare("SELECT 1 FROM invite_keys WHERE code=? LIMIT 1").get(next))redirect("/admin?error=key_conflict");const tx=db.transaction(()=>{db.prepare("UPDATE settings SET value=? WHERE key='group_key'").run(next);db.prepare("UPDATE settings SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='group_key_version'").run();addAuditLog("group_key.rotated","setting",null);});tx.immediate();revalidatePath("/admin");redirect("/admin?key_reset=1")}
export async function createInviteKey(form:FormData){await requireAdmin();const guest=text(form,"guest_name",80),code=text(form,"code",64);if(!guest)redirect("/admin?error=name");if(!validKeyCode(code))redirect("/admin?error=key_format");if(keyCodeTaken(code))redirect("/admin?error=key_conflict");db.transaction(()=>{const id=Number(db.prepare("INSERT INTO invite_keys (guest_name,code) VALUES (?,?)").run(guest,code).lastInsertRowid);addAuditLog("invite_key.created","invite_key",id)}) .immediate();revalidatePath("/admin");redirect("/admin?invite_created=1")}
export async function resetInviteKey(form:FormData){await requireAdmin();const id=Number(text(form,"id",20)),code=text(form,"code",64);if(!validKeyCode(code))redirect("/admin?error=key_format");if(keyCodeTaken(code,id))redirect("/admin?error=key_conflict");db.transaction(()=>{const result=db.prepare("UPDATE invite_keys SET code=?,version=version+1,active=1 WHERE id=?").run(code,id);if(result.changes)addAuditLog("invite_key.rotated","invite_key",id)}) .immediate();revalidatePath("/admin");redirect("/admin?invite_reset=1")}
export async function toggleInviteKey(form:FormData){await requireAdmin();const id=Number(text(form,"id",20));db.transaction(()=>{const result=db.prepare("UPDATE invite_keys SET active=CASE active WHEN 1 THEN 0 ELSE 1 END,version=version+1 WHERE id=?").run(id);if(result.changes)addAuditLog("invite_key.toggled","invite_key",id)}) .immediate();revalidatePath("/admin");redirect("/admin")}

export async function cancelOwnRequest(token:string) {
  try{cancelTrackedRequestInTransaction({db,token})}catch{redirect("/")}
  revalidatePath("/"); redirect(`/request/${token}?cancelled=1`);
}

export async function editOwnRequest(token:string,form:FormData){
  if(!(await rateLimit("edit-request",20)))redirect(`/request/${token}?error=rate`);
  const guest=text(form,"guest_name",80),start=text(form,"starts_on"),end=text(form,"ends_on"),size=Number(text(form,"party_size",20)),rawNote=String(form.get("note")??"").trim();
  if(!guest||!validIsoDate(start)||!validIsoDate(end)||start>=end||nightsBetween(start,end)>90||!Number.isInteger(size)||size<1||size>8||rawNote.length>1000)redirect(`/request/${token}?error=form`);
  let result:"updated"|"change_requested"="updated";
  const tx=db.transaction(()=>{
    const request=db.prepare(`SELECT q.id,q.status,q.stay_id,q.guest_name,q.starts_on,q.ends_on,q.party_size,
      q.accepts_sofa,q.accepts_air_mattress,q.exclusive,
      s.starts_on stay_starts_on,s.ends_on stay_ends_on
      FROM requests q JOIN stays s ON s.id=q.stay_id WHERE q.manage_token=? AND q.deleted_at IS NULL`).get(token) as {id:number;status:string;stay_id:number;guest_name:string;starts_on:string;ends_on:string;party_size:number;accepts_sofa:number;accepts_air_mattress:number;exclusive:number;stay_starts_on:string|null;stay_ends_on:string|null}|undefined;
    if(!request||!["pending","approved","rejected"].includes(request.status))throw new Error("status");
    if((request.stay_starts_on&&start<request.stay_starts_on)||(request.stay_ends_on&&end>request.stay_ends_on))throw new Error("dates");
    if(db.prepare("SELECT 1 FROM blackouts WHERE stay_id=? AND starts_on < ? AND ends_on > ? LIMIT 1").get(request.stay_id,end,start))throw new Error("blocked");
    const isHome=!request.stay_starts_on&&!request.stay_ends_on,acceptsSofa=isHome&&form.get("accepts_sofa")?1:0,acceptsAirMattress=isHome&&form.get("accepts_air_mattress")?1:0,exclusive=form.get("exclusive")?1:0;
    if(request.status==="pending"||request.status==="rejected"){
      db.prepare(`UPDATE requests SET guest_name=?,starts_on=?,ends_on=?,party_size=?,accepts_sofa=?,
        accepts_air_mattress=?,exclusive=?,note=?,status='pending' WHERE id=?`).run(guest,start,end,size,acceptsSofa,acceptsAirMattress,exclusive,rawNote,request.id);
      return;
    }
    const pending=db.prepare("SELECT id FROM request_changes WHERE request_id=? AND status='pending'").get(request.id) as {id:number}|undefined;
    const approvalFieldsUnchanged=guest===request.guest_name&&start===request.starts_on&&end===request.ends_on&&size===request.party_size&&acceptsSofa===request.accepts_sofa&&acceptsAirMattress===request.accepts_air_mattress&&exclusive===request.exclusive;
    if(approvalFieldsUnchanged){
      db.prepare("UPDATE requests SET note=? WHERE id=?").run(rawNote,request.id);
      if(pending)db.prepare("UPDATE request_changes SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(pending.id);
      return;
    }
    result="change_requested";
    if(pending)db.prepare(`UPDATE request_changes SET guest_name=?,starts_on=?,ends_on=?,party_size=?,accepts_sofa=?,
      accepts_air_mattress=?,exclusive=?,note=?,created_at=CURRENT_TIMESTAMP WHERE id=?`).run(guest,start,end,size,acceptsSofa,acceptsAirMattress,exclusive,rawNote,pending.id);
    else db.prepare(`INSERT INTO request_changes (request_id,guest_name,starts_on,ends_on,party_size,accepts_sofa,accepts_air_mattress,exclusive,note)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(request.id,guest,start,end,size,acceptsSofa,acceptsAirMattress,exclusive,rawNote);
  });
  try{tx.immediate();}catch(error){if(error instanceof Error&&["blocked","dates","status"].includes(error.message))redirect(`/request/${token}?error=${error.message}`);throw error;}
  revalidatePath("/");revalidatePath("/admin");revalidatePath(`/request/${token}`);
  redirect(`/request/${token}?${result}=1`);
}

export async function reviewRequestChange(form:FormData){
  await requireAdmin();
  const changeId=Number(text(form,"change_id",20)),decision=text(form,"decision",20);
  if(!Number.isInteger(changeId)||!["approve","reject"].includes(decision))redirect("/admin?error=form");
  let token="";
  try{token=reviewRequestChangeInTransaction({db,changeId,decision,suggestAllocation,audit:()=>addAuditLog(`request_change.${decision === "approve" ? "approved" : "rejected"}`,"request_change",changeId)});}catch(error){if(error instanceof Error&&["blocked","capacity","dates","form"].includes(error.message))redirect(`/admin?error=${error.message}`);throw error;}
  revalidatePath("/");revalidatePath("/admin");if(token)revalidatePath(`/request/${token}`);
  redirect(`/admin?${decision==="approve"?"change_approved":"change_rejected"}=1`);
}

export async function cancelInviteRequest(form:FormData){
  const access=await getGroupAccess();
  if(!access?.inviteKeyId)redirect("/?error=locked");
  const id=Number(text(form,"id",20));
  const tx=db.transaction(()=>{
    const result=db.prepare("UPDATE requests SET status='cancelled' WHERE id=? AND invite_key_id=? AND status IN ('pending','approved')").run(id,access.inviteKeyId);
    if(result.changes){db.prepare("DELETE FROM allocations WHERE request_id=?").run(id);db.prepare("UPDATE request_changes SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='pending'").run(id);}
  });
  tx();revalidatePath("/");revalidatePath("/my-requests");redirect("/my-requests?cancelled=1");
}
