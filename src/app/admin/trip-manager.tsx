"use client";

import { useState } from "react";
import { createStay, deleteStay, editStay } from "@/app/actions";
import type { Stay, StayResource } from "@/lib/db";
import AdminPanel from "./admin-panel";

export default function TripManager({
  stays,
  resources,
  today,
}: {
  stays: Stay[];
  resources: StayResource[];
  today: string;
}) {
  const trips = stays.filter((stay) => stay.starts_on && stay.ends_on);
  const current = trips.filter((stay) => stay.ends_on! > today);
  const archived = trips.filter((stay) => stay.ends_on! <= today).reverse();
  const [query, setQuery] = useState("");
  const archivedMatches = archived.filter((stay) =>
    `${stay.name} ${stay.location} ${stay.starts_on} ${stay.ends_on}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  function card(stay: Stay) {
    const beds = resources.filter((resource) => resource.stay_id === stay.id);
    return (
      <details className="create-panel" key={stay.id}>
        <summary>
          {stay.name} · {stay.starts_on} → {stay.ends_on}
        </summary>
        <form action={editStay}>
          <input type="hidden" name="stay_id" value={stay.id} />
          <div className="row">
            <label>
              名称
              <input name="name" defaultValue={stay.name} required maxLength={100} />
            </label>
            <label>
              地点
              <input name="location" defaultValue={stay.location} required maxLength={120} />
            </label>
          </div>
          <div className="row">
            <label>
              入住开始
              <input name="starts_on" type="date" defaultValue={stay.starts_on!} required />
            </label>
            <label>
              最后退房
              <input name="ends_on" type="date" defaultValue={stay.ends_on!} required />
            </label>
          </div>
          <label>
            睡位 <small>每行：名称 | 人数；顺序就是自动分配优先级</small>
            <textarea
              name="resources"
              rows={Math.max(3, beds.length)}
              defaultValue={beds.map((resource) => `${resource.name} | ${resource.capacity}`).join("\n")}
              required
            />
          </label>
          <p className="muted">若创建时同步关闭了固定住所，修改日期会同步更新对应的不可住时段。</p>
          <button className="primary">保存旅行修改</button>
        </form>
        <form
          action={deleteStay}
          className="danger-zone"
          onSubmit={(event) => {
            if (!window.confirm(`确定删除“${stay.name}”吗？旅行睡位及已取消/拒绝的历史记录也会删除。`))
              event.preventDefault();
          }}
        >
          <input type="hidden" name="stay_id" value={stay.id} />
          <span>
            <b>删除临时住宿</b>
            <small>仍有待确认或已确认住客时，系统会拒绝删除。</small>
          </span>
          <button className="danger-button">删除旅行</button>
        </form>
      </details>
    );
  }

  return (
    <AdminPanel
      eyebrow="TRIPS"
      title="旅行住宿"
      description="创建临时住宿，维护行程日期、地点和睡位。"
      count={`${current.length} 个当前 / 即将到来`}
      defaultOpen={current.length > 0}
    >
      <div className="request-list">
        {current.length === 0 && <p className="empty">目前没有即将到来的旅行住宿。</p>}
        {current.map(card)}
      </div>

      <details className="admin-subpanel">
        <summary>创建旅行住宿</summary>
        <form action={createStay}>
          <div className="row">
            <label>
              名称
              <input name="name" required maxLength={100} placeholder="Weekend trip" />
            </label>
            <label>
              地点
              <input name="location" required maxLength={120} placeholder="Destination" />
            </label>
          </div>
          <div className="row">
            <label>
              开始
              <input name="starts_on" type="date" required />
            </label>
            <label>
              结束
              <input name="ends_on" type="date" required />
            </label>
          </div>
          <label>
            睡位 <small>每行：名称 | 人数；从上到下是分配优先级</small>
            <textarea
              name="resources"
              rows={5}
              defaultValue={
                "Room A · Queen 1 | 2\nRoom A · Queen 2 | 2\nRoom B · Queen 1 | 2\nRoom B · Queen 2 | 2"
              }
              required
            />
          </label>
          <label className="check">
            <input name="block_home" type="checkbox" defaultChecked /> 同期将固定住所标记为不可住
          </label>
          <button className="primary">创建旅行住宿</button>
        </form>
      </details>

      {archived.length > 0 && (
        <details className="archive-panel">
          <summary>
            Archive · 已结束旅行 <span>{archived.length}</span>
          </summary>
          <div className="archive-tools">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、地点或日期…"
              aria-label="搜索已结束旅行"
            />
          </div>
          <div className="request-list">
            {archivedMatches.length ? (
              archivedMatches.map(card)
            ) : (
              <p className="empty">没有找到符合条件的旅行。</p>
            )}
          </div>
        </details>
      )}
    </AdminPanel>
  );
}
