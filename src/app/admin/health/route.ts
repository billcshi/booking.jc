import { isAdmin } from "@/lib/auth";
import { db, getSetting } from "@/lib/db";
export const dynamic="force-dynamic";
export async function GET(){if(!await isAdmin())return Response.json({error:"unauthorized"},{status:401});let database="ok";try{db.prepare("SELECT 1").get()}catch{database="error"}return Response.json({status:database==="ok"?"ok":"degraded",database,schema_version:getSetting("schema_version")??"unknown",app_version:process.env.npm_package_version??"unknown"},{headers:{"cache-control":"private, no-store"}})}
