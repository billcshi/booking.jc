import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requiredSecret } from "@/lib/security";
import { db, getSetting } from "@/lib/db";

const COOKIE = "booking_jc_admin";
const GROUP_COOKIE = "booking_jc_group";

function secret() { return requiredSecret("SESSION_SECRET"); }
function sign(value: string) { return createHmac("sha256", secret()).update(value).digest("hex"); }

export async function isAdmin() {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || signature.length !== 64) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload))) && Number(payload) > Date.now();
}

export async function createAdminSession() {
  const expires = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  (await cookies()).set(COOKIE, `${expires}.${sign(expires)}`, { httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV==="production", maxAge:604800, path:"/" });
}

export async function clearAdminSession() { (await cookies()).delete(COOKIE); }
export async function clearGroupSession(){(await cookies()).delete(GROUP_COOKIE);}

export async function getGroupAccess():Promise<{guestName:string|null;inviteKeyId:number|null}|null> {
  const value=(await cookies()).get(GROUP_COOKIE)?.value;
  if(!value) return null;
  const [payload,signature]=value.split(".");
  if(!payload||!signature||signature.length!==64||!timingSafeEqual(Buffer.from(signature),Buffer.from(sign(`group:${payload}`)))) return null;
  const [expires,kind,idOrVersion,inviteVersion]=payload.split(":");
  if(Number(expires)<=Date.now())return null;
  if(idOrVersion===undefined)return kind===getSetting("group_key_version")?{guestName:null,inviteKeyId:null}:null;
  if(kind==="g")return idOrVersion===getSetting("group_key_version")?{guestName:null,inviteKeyId:null}:null;
  if(kind==="i"){
    const invite=db.prepare("SELECT guest_name FROM invite_keys WHERE id=? AND version=? AND active=1").get(Number(idOrVersion),Number(inviteVersion)) as {guest_name:string}|undefined;
    return invite?{guestName:invite.guest_name,inviteKeyId:Number(idOrVersion)}:null;
  }
  return null;
}

export async function hasGroupAccess() { return Boolean(await getGroupAccess()); }

export async function createGroupSession() {
  const expires=String(Date.now()+30*24*60*60*1000),payload=`${expires}:g:${getSetting("group_key_version")??"1"}`;
  (await cookies()).set(GROUP_COOKIE,`${payload}.${sign(`group:${payload}`)}`,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:2592000,path:"/"});
}

export async function createInviteSession(id:number,version:number) {
  const expires=String(Date.now()+30*24*60*60*1000),payload=`${expires}:i:${id}:${version}`;
  (await cookies()).set(GROUP_COOKIE,`${payload}.${sign(`group:${payload}`)}`,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:2592000,path:"/"});
}
