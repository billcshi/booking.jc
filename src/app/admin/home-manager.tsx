"use client";

import { useState } from "react";
import { editHome } from "@/app/actions";
import type { Stay, StayResource } from "@/lib/db";
import AdminPanel from "./admin-panel";

type EditableResource = StayResource & { rowKey: string };

export default function HomeManager({
  home,
  resources,
  hostDisplayName,
}: {
  home: Stay;
  resources: StayResource[];
  hostDisplayName: string;
}) {
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
      title="固定住所"
      description="维护住所名称、地点标签、睡位容量和自动分配顺序。"
      count={`${rows.length} 个睡位`}
    >
        <form action={editHome}>
          <input type="hidden" name="stay_id" value={home.id} />
          <label>
            Host 显示名
            <input
              name="host_display_name"
              defaultValue={hostDisplayName}
              required
              maxLength={40}
            />
            <small>用于“提交给谁确认”等公共文案，例如 Host、JC 或你的昵称。</small>
          </label>
          <div className="row">
            <label>
              显示名称
              <input name="name" defaultValue={home.name} required maxLength={100} />
            </label>
            <label>
              地点标签
              <input name="location" defaultValue={home.location} required maxLength={120} />
            </label>
          </div>
          <div className="resource-editor">
            {rows.map((resource, index) => (
              <div className="resource-row" key={resource.rowKey}>
                <input name="resource_id" type="hidden" value={resource.id || ""} />
                <label>
                  睡位名称
                  <input
                    name="resource_name"
                    value={resource.name}
                    onChange={(event) => update(resource.rowKey, { name: event.target.value })}
                    required
                    maxLength={100}
                  />
                </label>
                <label>
                  容量
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
                  可见性
                  <select
                    name="resource_admin_only"
                    value={resource.admin_only}
                    onChange={(event) => update(resource.rowKey, { admin_only: Number(event.target.value) })}
                  >
                    <option value={0}>公开容量</option>
                    <option value={1}>仅管理员备用</option>
                  </select>
                </label>
                <label>
                  使用条件
                  <select
                    name="resource_sofa_consent"
                    value={resource.requires_sofa_consent}
                    onChange={(event) => update(resource.rowKey, { requires_sofa_consent: Number(event.target.value) })}
                  >
                    <option value={0}>无需额外同意</option>
                    <option value={1}>需住客接受 sofa</option>
                  </select>
                </label>
                <div className="resource-actions">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`上移 ${resource.name || "新睡位"}`}>↑</button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === rows.length - 1} aria-label={`下移 ${resource.name || "新睡位"}`}>↓</button>
                  <button type="button" className="danger-button" onClick={() => setRows((current) => current.filter((row) => row.rowKey !== resource.rowKey))}>移除</button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addResource}>添加睡位</button>
          <p className="muted">顺序决定自动分配优先级。已有分配的睡位不能删除，容量也不能低于其历史峰值。</p>
          <button className="primary">保存固定住所设置</button>
        </form>
    </AdminPanel>
  );
}
