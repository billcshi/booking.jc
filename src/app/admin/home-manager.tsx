"use client";

import { useState } from "react";
import { editHome } from "@/app/actions";
import type { Stay, StayResource } from "@/lib/db";
import AdminPanel from "./admin-panel";
import { useI18n } from "../locale-provider";

type EditableResource = StayResource & { rowKey: string };

export default function HomeManager({
  home,
  resources,
  hostDisplayName,
  showSmokingNotice,
  showAlcoholNotice,
  showQuietHoursNotice,
}: {
  home: Stay;
  resources: StayResource[];
  hostDisplayName: string;
  showSmokingNotice: boolean;
  showAlcoholNotice: boolean;
  showQuietHoursNotice: boolean;
}) {
  const { t } = useI18n();
  const [nextKey, setNextKey] = useState(1);
  const [rows, setRows] = useState<EditableResource[]>(
    resources.map((resource) => ({ ...resource, rowKey: `resource-${resource.id}` })),
  );

  function update(rowKey: string, change: Partial<EditableResource>) {
    setRows((current) =>
      current.map((row) => (row.rowKey === rowKey ? { ...row, ...change } : row)),
    );
  }

  function move(index: number, delta: number) {
    setRows((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addResource() {
    const rowKey = `new-${nextKey}`;
    setNextKey((value) => value + 1);
    setRows((current) => [
      ...current,
      {
        id: 0,
        stay_id: home.id,
        name: "",
        capacity: 1,
        priority: current.length + 1,
        admin_only: 0,
        requires_sofa_consent: 0,
        rowKey,
      },
    ]);
  }

  return (
    <AdminPanel
      eyebrow="HOME"
      title={t("固定住所")} description={t("维护住所名称、地点标签、睡位容量和自动分配顺序。")} count={`${rows.length} ${t("个睡位")}`}
    >
        <form action={editHome}>
          <input type="hidden" name="stay_id" value={home.id} />
          <label>
            {t("Host 显示名")}
            <input
              name="host_display_name"
              defaultValue={hostDisplayName}
              required
              maxLength={40}
            />
            <small>{t("用于“提交给谁确认”等公共文案，例如 Host 或你的昵称。")}</small>
          </label>
          <div className="row">
            <label>
              {t("显示名称")}
              <input name="name" defaultValue={home.name} required maxLength={100} />
            </label>
            <label>
              {t("地点标签")}
              <input name="location" defaultValue={home.location} required maxLength={120} />
            </label>
          </div>
          <fieldset className="house-rule-settings" aria-describedby="house-rule-settings-help">
            <legend>{t("入住须知")}</legend>
            <p id="house-rule-settings-help">{t("分别控制固定住所公开页面上的三条提示。")}</p>
            <div className="house-rule-options">
              <label className="house-rule-option">
                <input
                  name="show_smoking_notice"
                  type="checkbox"
                  defaultChecked={showSmokingNotice}
                />
                <span><b>{t("显示禁烟提示")}</b><small>{t("无烟住所，涵盖电子烟、烟草与大麻，并说明 Host 对烟味敏感。")}</small></span>
              </label>
              <label className="house-rule-option">
                <input
                  name="show_alcohol_notice"
                  type="checkbox"
                  defaultChecked={showAlcoholNotice}
                />
                <span><b>{t("显示饮酒提示")}</b><small>{t("说明年龄限制与 Host 的饮酒建议。")}</small></span>
              </label>
              <label className="house-rule-option">
                <input
                  name="show_quiet_hours_notice"
                  type="checkbox"
                  defaultChecked={showQuietHoursNotice}
                />
                <span><b>{t("显示安静时段提示")}</b><small>{t("晚上 10 点后请保持安静；违反规定时 HOA 会向房东收取 500 美元罚款。")}</small></span>
              </label>
            </div>
          </fieldset>
          <div className="resource-editor">
            {rows.map((resource, index) => (
              <div className="resource-row" key={resource.rowKey}>
                <input name="resource_id" type="hidden" value={resource.id || ""} />
                <label>
                  {t("睡位名称")}
                  <input
                    name="resource_name"
                    value={resource.name}
                    onChange={(event) => update(resource.rowKey, { name: event.target.value })}
                    required
                    maxLength={100}
                  />
                </label>
                <label>
                  {t("容量")}
                  <input
                    name="resource_capacity"
                    type="number"
                    min={1}
                    max={8}
                    value={resource.capacity}
                    onChange={(event) => update(resource.rowKey, { capacity: Number(event.target.value) })}
                    required
                  />
                </label>
                <label>
                  {t("访客申请范围")}
                  <select
                    name="resource_admin_only"
                    value={resource.admin_only}
                    onChange={(event) => update(resource.rowKey, { admin_only: Number(event.target.value) })}
                  >
                    <option value={0}>{t("访客可申请")}</option><option value={1}>{t("仅 Host 可安排")}</option>
                  </select>
                  <small>{resource.admin_only ? t("不向访客显示，也不计入公开容量。") : t("访客可在公开日历中申请使用。")}</small>
                </label>
                <label>
                  {t("使用条件")}
                  <select
                    name="resource_sofa_consent"
                    value={resource.requires_sofa_consent}
                    onChange={(event) => update(resource.rowKey, { requires_sofa_consent: Number(event.target.value) })}
                  >
                    <option value={0}>{t("无需额外同意")}</option><option value={1}>{t("需住客接受 sofa")}</option>
                  </select>
                </label>
                <div className="resource-actions">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`${t("上移")} ${resource.name || t("新睡位")}`}>↑</button><button type="button" onClick={() => move(index, 1)} disabled={index === rows.length - 1} aria-label={`${t("下移")} ${resource.name || t("新睡位")}`}>↓</button><button type="button" className="danger-button" onClick={() => setRows((current) => current.filter((row) => row.rowKey !== resource.rowKey))}>{t("移除")}</button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addResource}>{t("添加睡位")}</button><p className="muted">{t("顺序决定自动分配优先级。已有分配的睡位不能删除，容量也不能低于其历史峰值。")}</p><button className="primary">{t("保存固定住所设置")}</button>
        </form>
    </AdminPanel>
  );
}
