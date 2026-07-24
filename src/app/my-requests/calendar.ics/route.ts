import { getGroupAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  buildStayCalendar,
  calendarResponse,
  type CalendarRequest,
} from "@/lib/icalendar";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getGroupAccess();
  if (!access?.inviteKeyId) return new Response("Not found", { status: 404 });

  const rows = db.prepare(`SELECT q.id,s.name stay,q.guest_name,q.starts_on,q.ends_on,q.party_size
    FROM requests q JOIN stays s ON s.id=q.stay_id
    WHERE q.invite_key_id=? AND q.status='approved' AND q.deleted_at IS NULL
    ORDER BY q.starts_on,q.ends_on,s.name,q.created_at`).all(access.inviteKeyId) as CalendarRequest[];

  return calendarResponse(
    buildStayCalendar(rows, `invite-${access.inviteKeyId}.booking.jc`),
    "my-stays.ics",
  );
}
