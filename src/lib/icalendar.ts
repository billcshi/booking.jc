export type CalendarRequest = {
  id: number;
  stay: string;
  guest_name: string;
  starts_on: string;
  ends_on: string;
  party_size: number;
};

const escapeText = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");

const dateStamp = (value: string) => value.replaceAll("-", "");

export function buildStayCalendar(
  requests: CalendarRequest[],
  uidScope: string,
) {
  const groups = new Map<string, CalendarRequest[]>();
  for (const request of requests) {
    const key = `${request.stay}\0${request.starts_on}\0${request.ends_on}`;
    groups.set(key, [...(groups.get(key) ?? []), request]);
  }

  const events = [...groups.values()].map((group) => {
    const first = group[0];
    const guests = group
      .map((request) => `${request.guest_name} (${request.party_size})`)
      .join(", ");
    const ids = group.map((request) => request.id).sort((a, b) => a - b);
    return [
      "BEGIN:VEVENT",
      `UID:stay-${ids.join("-")}@${uidScope}`,
      `DTSTART;VALUE=DATE:${dateStamp(first.starts_on)}`,
      `DTEND;VALUE=DATE:${dateStamp(first.ends_on)}`,
      `SUMMARY:${escapeText(`${first.stay} — ${guests}`)}`,
      "END:VEVENT",
    ];
  });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//booking.jc//Stayboard//EN",
    "CALSCALE:GREGORIAN",
    ...events.flat(),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function calendarResponse(body: string, filename: string) {
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename=${filename}`,
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
