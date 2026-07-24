import { db } from "@/lib/db";
import {
  buildStayCalendar,
  calendarResponse,
  type CalendarRequest,
} from "@/lib/icalendar";

export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const request = db.prepare(`SELECT q.id,s.name stay,q.guest_name,q.starts_on,q.ends_on,q.party_size
    FROM requests q JOIN stays s ON s.id=q.stay_id
    WHERE q.manage_token=? AND q.status='approved' AND q.deleted_at IS NULL`).get(token) as CalendarRequest | undefined;

  if (!request) return new Response("Not found", { status: 404 });

  return calendarResponse(
    buildStayCalendar([request], `request-${request.id}.booking.jc`),
    "my-stay.ics",
  );
}
