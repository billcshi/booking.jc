"use client";
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
  return (
    <AdminPanel
      eyebrow="AVAILABILITY"
      title={t("不可住时段")} description={t("旅行、装修或私人安排期间，关闭指定地点的预约。")} count={`${blackouts.length} ${t("个生效中")}`}
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
        <label>
          {t("公开原因")}<input name="reason" maxLength={120} defaultValue={t("Host 外出")} />
        </label>
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
