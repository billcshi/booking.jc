"use client";

import { useState } from "react";
import type {
  BookingRequest,
  RequestAllocation,
  StayResource,
} from "@/lib/db";
import { deleteRequest, editRequest, updateRequest } from "@/app/actions";
import AdminPanel from "./admin-panel";

const labels: Record<string, string> = {
  pending: "待确认",
  approved: "已确认",
  rejected: "已拒绝",
  cancelled: "已取消",
};

function requestCardVersion(
  request: BookingRequest,
  allocations: RequestAllocation[],
) {
  return JSON.stringify([
    request.id,
    request.guest_name,
    request.starts_on,
    request.ends_on,
    request.party_size,
    request.status,
    request.accepts_sofa,
    request.accepts_air_mattress,
    request.exclusive,
    request.note,
    allocations.map((allocation) => [allocation.resource_id, allocation.seats]),
  ]);
}

function RequestCard({
  request: r,
  resources,
  allocations,
}: {
  request: BookingRequest;
  resources: StayResource[];
  allocations: RequestAllocation[];
}) {
  const [allocationMode, setAllocationMode] = useState(
    r.status === "approved" ? "manual" : "auto",
  );
  return (
    <article className="request-card">
      <div className="request-top">
        <div>
          <span className={`status ${r.status}`}>
            {labels[r.status] ?? r.status}
          </span>
          <h3>
            {r.guest_name} · {r.party_size} 人 {r.exclusive ? "· 🔒 独占" : ""}
          </h3>
          <p>
            {r.stay_name} · {r.starts_on} → {r.ends_on}
          </p>
        </div>
        {r.status === "pending" && (
          <div className="actions">
            <form action={updateRequest}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="status" value="approved" />
              <button className="approve">确认并安排</button>
            </form>
            <form action={updateRequest}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="status" value="rejected" />
              <button>拒绝</button>
            </form>
          </div>
        )}
      </div>
      <div className="request-detail">
        {r.is_home? <>
        <span>Sofa：{r.accepts_sofa ? "可以" : "不可以"}</span>
        <span>隐藏备用位：{r.accepts_air_mattress ? "接受" : "不接受"}</span>
        </>:null}
        {r.allocation && <strong>安排：{r.allocation}</strong>}
        {r.note && <span>备注：{r.note}</span>}
      </div>
      <details className="edit-request">
        <summary>编辑这条记录</summary>
        <form action={editRequest}>
          <input type="hidden" name="id" value={r.id} />
          <label>
            姓名 / 昵称
            <input
              name="guest_name"
              defaultValue={r.guest_name}
              required
              maxLength={80}
            />
          </label>
          <div className="row">
            <label>
              入住
              <input
                name="starts_on"
                type="date"
                defaultValue={r.starts_on}
                required
              />
            </label>
            <label>
              退房
              <input
                name="ends_on"
                type="date"
                defaultValue={r.ends_on}
                required
              />
            </label>
          </div>
          <div className="row">
            <label>
              人数
              <input
                name="party_size"
                type="number"
                min="1"
                max="8"
                defaultValue={r.party_size}
                required
              />
            </label>
            <label>
              状态
              <select name="status" defaultValue={r.status}>
                <option value="pending">待确认</option>
                <option value="approved">已确认</option>
                <option value="rejected">已拒绝</option>
                <option value="cancelled">已取消</option>
              </select>
            </label>
          </div>
          <div className="edit-checks">
            {r.is_home?<>
            <label className="check">
              <input
                name="accepts_sofa"
                type="checkbox"
                defaultChecked={Boolean(r.accepts_sofa)}
              />{" "}
              可以睡 sofa
            </label>
            <label className="check">
              <input
                name="accepts_air_mattress"
                type="checkbox"
                defaultChecked={Boolean(r.accepts_air_mattress)}
              />{" "}
              接受隐藏备用位
            </label>
            </>:null}
            <label className="check">
              <input
                name="exclusive"
                type="checkbox"
                defaultChecked={Boolean(r.exclusive)}
              />{" "}
              独占住宿
            </label>
          </div>
          <fieldset className="allocation-editor">
            <legend>床位分配</legend>
            <label>
              分配方式
              <select
                name="allocation_mode"
                value={allocationMode}
                onChange={(event) => setAllocationMode(event.target.value)}
              >
                <option value="manual">保留 / 手动调整</option>
                <option value="auto">按当前规则自动重新分配</option>
              </select>
            </label>
            <p className="muted">
              仅“已确认”状态会占用床位；手动分配的人数之和必须等于住宿人数。
            </p>
            {allocationMode === "manual" && (
              <div className="allocation-resource-list">
                {resources.map((resource) => {
                  const current = allocations.find(
                    (allocation) => allocation.resource_id === resource.id,
                  );
                  return (
                    <label className="allocation-resource" key={resource.id}>
                      <input
                        name="allocation_resource_id"
                        type="hidden"
                        value={resource.id}
                      />
                      <span>
                        <b>{resource.name}</b>
                        <small>
                          容量 {resource.capacity}
                          {resource.requires_sofa_consent ? " · 需接受 sofa" : ""}
                          {resource.admin_only ? " · 隐藏备用位" : ""}
                        </small>
                      </span>
                      <input
                        aria-label={`${resource.name} 分配人数`}
                        name="allocation_seats"
                        type="number"
                        min={0}
                        max={resource.capacity}
                        defaultValue={current?.seats ?? 0}
                        required
                      />
                    </label>
                  );
                })}
                {resources.length === 0 && <p className="muted">这个住宿还没有可用睡位。</p>}
              </div>
            )}
          </fieldset>
          <label>
            备注
            <textarea
              name="note"
              rows={2}
              defaultValue={r.note}
              maxLength={1000}
            />
          </label>
          <button className="primary">保存修改并重新检查</button>
        </form>
        <form
          action={deleteRequest}
          className="danger-zone"
          onSubmit={(event) => {
            if (
              !window.confirm(
                `确定永久删除 ${r.guest_name} 的这条住宿记录吗？对应床位会立即释放，私密链接也会失效。`,
              )
            )
              event.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={r.id} />
          <span>
            <b>删除并释放</b>
            <small>永久删除记录，并立即释放已安排的床位。</small>
          </span>
          <button className="danger-button">删除记录</button>
        </form>
      </details>
    </article>
  );
}

export default function RequestList({
  requests,
  resources,
  allocations,
  today,
}: {
  requests: BookingRequest[];
  resources: StayResource[];
  allocations: RequestAllocation[];
  today: string;
}) {
  const current = requests.filter((r) => r.ends_on > today);
  const archived = requests
    .filter((r) => r.ends_on <= today)
    .sort((a, b) => b.ends_on.localeCompare(a.ends_on));
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const matches = archived.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      `${r.guest_name} ${r.stay_name} ${r.starts_on} ${r.ends_on} ${r.note ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pendingCount = current.filter((request) => request.status === "pending").length;
  return (
    <AdminPanel
      eyebrow="REQUESTS"
      title="申请与住宿记录"
      description="先处理待确认申请，再查看即将入住和历史记录。"
      count={pendingCount ? `${pendingCount} 个待处理` : `${current.length} 个当前记录`}
      defaultOpen
    >
      <div className="request-list">
        {current.length === 0 && (
          <p className="empty">目前没有待处理或未来住宿记录。</p>
        )}
        {current.map((r) => {
          const requestAllocations = allocations.filter(
            (allocation) => allocation.request_id === r.id,
          );
          return (
            <RequestCard
              request={r}
              resources={resources.filter((resource) => resource.stay_id === r.stay_id)}
              allocations={requestAllocations}
              key={requestCardVersion(r, requestAllocations)}
            />
          );
        })}
      </div>
      {archived.length > 0 && (
        <details className="archive-panel">
          <summary>
            Archive · 历史住宿记录 <span>{archived.length}</span>
          </summary>
          <div className="archive-tools">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索昵称、住宿或日期…"
              aria-label="搜索历史住宿记录"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="筛选历史记录状态"
            >
              <option value="all">全部状态</option>
              <option value="approved">已确认</option>
              <option value="rejected">已拒绝</option>
              <option value="cancelled">已取消</option>
              <option value="pending">待确认</option>
            </select>
          </div>
          <div className="request-list">
            {matches.length ? (
              matches.map((r) => {
                const requestAllocations = allocations.filter(
                  (allocation) => allocation.request_id === r.id,
                );
                return (
                  <RequestCard
                    request={r}
                    resources={resources.filter((resource) => resource.stay_id === r.stay_id)}
                    allocations={requestAllocations}
                    key={requestCardVersion(r, requestAllocations)}
                  />
                );
              })
            ) : (
              <p className="empty">没有找到符合条件的历史记录。</p>
            )}
          </div>
        </details>
      )}
    </AdminPanel>
  );
}
