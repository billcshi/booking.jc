import assert from "node:assert/strict";
import test from "node:test";
import { blackoutLabel } from "../src/lib/i18n.ts";

for (const [type, zh, en] of [
  ["pause", "暂停接待住客", "Not hosting guests"],
  ["away", "Host 外出", "Host away"],
]) {
  test(type + " renders in the viewer's language for new and legacy rows", () => {
    for (const row of [
      { reason_type: type, reason: "" },
      { reason_type: null, reason: zh },
      { reason_type: null, reason: en },
    ]) {
      assert.equal(blackoutLabel(row, "en", true), en);
      assert.equal(blackoutLabel(row, "zh-CN", true), zh);
    }
  });
}

test("custom text is literal, including reserved-looking labels and trip prefixes", () => {
  for (const reason of ["Not hosting guests", "Host 外出", "外出：Example", "__private__", "  Example  "]) {
    for (const locale of ["zh-CN", "en"]) {
      assert.equal(blackoutLabel({ reason_type: "custom", reason }, locale, true), reason);
    }
  }
  const trip = { reason_type: null, reason: "外出：Example" };
  assert.equal(blackoutLabel(trip, "en", true), "Away: Example");
  assert.equal(blackoutLabel(trip, "zh-CN", true), trip.reason);
  assert.equal(blackoutLabel({ reason_type: null, reason: "Host away tomorrow" }, "zh-CN", true), "Host away tomorrow");
});

test("locked calendar receives only the localized generic label", () => {
  for (const reason_type of ["custom", "pause", "away", null]) {
    const row = { reason_type, reason: "Fictional private note" };
    assert.equal(blackoutLabel(row, "en", false), "Unavailable");
    assert.equal(blackoutLabel(row, "zh-CN", false), "不可住");
  }
});
