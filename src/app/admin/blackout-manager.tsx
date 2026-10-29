"use client";
import { useState } from "react";
import type { Blackout, Stay } from "@/lib/db";
import { createBlackout, removeBlackout } from "@/app/actions";
import AdminPanel from "./admin-panel";
import { useI18n } from "../locale-provider";

export default function BlackoutManager({
  stays,
  blackouts,
}: {
  stays: Stay[];
  blackouts: Blackout[];
}) {
  const { t } = useI18n();
  const [reasonType, setReasonType] = useState<"pause" | "away" | "custom">("pause");

  const reasonOptions = [
    {
      value: "pause" as const,
      title: t("暂停接待"),
      description: t("人在家，但这段时间不接待住客。"),
      reason: t("暂停接待住客"),
    },
    {
      value: "away" as const,
      title: t("Host 外出"),
      description: t("旅行期间关闭固定住所。"),
      reason: t("Host 外出"),
    },
    {
      value: "custom" as const,
      title: t("其他原因"),
      description: t("装修、维护或其他私人安排。"),
      reason: "",
    },
  ];
  const selectedReason = reasonOptions.find((option) => option.value === reasonType)?.reason ?? "";

  return (
    <AdminPanel
      eyebrow="AVAILABILITY"
      title={t("不可住时段")} description={t("暂停接待、旅行或私人安排期间，关闭指定地点的预约。")} count={`${blackouts.length} ${t("个生效中")}`}
    >
      <form action={createBlackout}>
        <label>
          {t("地点")}
          <select name="stay_id" required>
            {stays.map((stay) => (
              <option key={stay.id} value={stay.id}>
                {stay.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            {t("开始日期")}
            <input name="starts_on" type="date" required />
          </label>
          <label>
            {t("恢复日期")}
            <input name="ends_on" type="date" required />
          </label>
        </div>
        <fieldset className="blackout-reason-picker">
          <legend>{t("关闭原因")}</legend>
          <div>
            {reasonOptions.map((option) => (
              <label key={option.value} className={reasonType === option.value ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="reason_type"
                  value={option.value}
                  checked={reasonType === option.value}
                  onChange={() => setReasonType(option.value)}
                />
                <span>
                  <b>{option.title}</b>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {reasonType === "custom" ? (
          <label>
            {t("公开原因")}
            <input name="reason" maxLength={120} required placeholder={t("例如：装修或维护")} />
          </label>
        ) : (
          <input type="hidden" name="reason" value={selectedReason} />
        )}
        <p className="blackout-reason-note">{t("该原因会向已解锁日历的访客显示。")}</p>
        <button className="primary">{t("设为不可住")}</button>
      </form>
      {blackouts.length > 0 && (
        <div className="blackout-list">
          {blackouts.map((blackout) => (
            <div key={blackout.id}>
              <span>
                <b>{blackout.stay_name}</b>
                <small>
                  {blackout.starts_on} → {blackout.ends_on} · {blackout.reason}
                </small>
              </span>
              <form action={removeBlackout}>
                <input type="hidden" name="id" value={blackout.id} />
                <button>{t("恢复开放")}</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </AdminPanel>
  );
}
