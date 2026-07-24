import assert from "node:assert/strict";
import test from "node:test";
import { buildStayCalendar } from "../src/lib/icalendar.ts";

test("calendar groups guests sharing the same stay and date range", () => {
  const calendar = buildStayCalendar([
    { id: 8, stay: "Lake House", guest_name: "Alice", starts_on: "2026-08-01", ends_on: "2026-08-03", party_size: 1 },
    { id: 3, stay: "Lake House", guest_name: "Bob", starts_on: "2026-08-01", ends_on: "2026-08-03", party_size: 2 },
    { id: 9, stay: "Lake House", guest_name: "Carol", starts_on: "2026-08-02", ends_on: "2026-08-03", party_size: 1 },
  ], "booking.jc");

  assert.equal((calendar.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.match(calendar, /UID:stay-3-8@booking\.jc/);
  assert.match(calendar, /SUMMARY:Lake House — Alice \(1\)\\, Bob \(2\)/);
  assert.match(calendar, /DTSTART;VALUE=DATE:20260801/);
  assert.match(calendar, /DTEND;VALUE=DATE:20260803/);
});
