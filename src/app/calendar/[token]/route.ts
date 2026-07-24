import { db, getSetting } from "@/lib/db";
import {
  buildStayCalendar,
  calendarResponse,
  type CalendarRequest,
} from "@/lib/icalendar";

export const dynamic="force-dynamic";

export async function GET(_:Request,{params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  if(token!==`${getSetting("calendar_feed_token")}.ics`)return new Response("Not found",{status:404});
  const rows=db.prepare(`SELECT q.id,s.name stay,q.guest_name,q.starts_on,q.ends_on,q.party_size
    FROM requests q JOIN stays s ON s.id=q.stay_id
    WHERE q.status='approved' AND q.deleted_at IS NULL
    ORDER BY q.starts_on,q.ends_on,s.name,q.created_at`).all() as CalendarRequest[];
  return calendarResponse(buildStayCalendar(rows,"booking.jc"),"booking-jc.ics");
}
