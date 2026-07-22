"use client";

import { useState } from "react";
import type {
  BookingRequest,
  RequestAllocation,
  StayResource,
} from "@/lib/db";
import { deleteRequest, editRequest, updateRequest } from "@/app/actions";
import AdminPanel from "./admin-panel";
import { useI18n } from "../locale-provider";

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
  const { locale, t } = useI18n();
  const labels: Record<string,string>={pending:t("待确认"),approved:t("已确认"),rejected:t("已拒绝"),cancelled:t("已取消")};
  const [allocationMode, setAllocationMode] = useState(
    r.status === "approved" ? "manual" : "auto",
  );
  const [linkCopied, setLinkCopied] = useState(false);
  const trackingPath = `/request/${r.manage_token}`;

  async function copyTrackingLink() {
    const trackingUrl = new URL(trackingPath, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setLinkCopied(true);
    } catch {
      const input = document.createElement("textarea");
      input.value = trackingUrl;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      setLinkCopied(copied);
    }
  }

  return (
    <article className="request-card">
      <div className="request-top">
        <div>
          <span className={`status ${r.status}`}>
            {labels[r.status] ?? r.status}
          </span>
          <h3>
            {r.guest_name} · {r.party_size} {t("人")} {r.exclusive ? `· 🔒 ${t("独占")}` : ""}
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
              <button className="approve">{t("确认并安排")}</button>
            </form>
            <form action={updateRequest}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="status" value="rejected" />
              <button>{t("拒绝")}</button>
            </form>
          </div>
        )}
      </div>
      <div className="request-detail">
        {r.is_home? <>
        <span>Sofa：{r.accepts_sofa ? t("可以") : t("不可以")}</span><span>{t("隐藏备用位")}：{r.accepts_air_mattress ? t("接受") : t("不接受")}</span>
        </>:null}
        {r.allocation && <strong>{t("安排")}：{r.allocation}</strong>}{r.note && <span>{t("备注")}：{r.note}</span>}
      </div>
      <div className="tracking-link-tools">
        <span>
          <b>{t("找回私密链接")}</b>
          <small>{t("复制原 tracking link，不会让客人已有的链接失效。")}</small>
        </span>
        <div>
          <button type="button" onClick={copyTrackingLink}>
            {linkCopied ? t("已复制") : t("复制 tracking link")}
          </button>
          <a href={trackingPath} target="_blank" rel="noreferrer">
            {t("打开链接")}
          </a>
        </div>
      </div>
      <details className="edit-request">
        <summary>{t("编辑这条记录")}</summary>
        <form action={editRequest}>
          <input type="hidden" name="id" value={r.id} />
          <label>
            {t("姓名 / 昵称")}
            <input
              name="guest_name"
              defaultValue={r.guest_name}
              required
              maxLength={80}
            />
          </label>
          <div className="row">
            <label>
              {t("入住")}
              <input
                name="starts_on"
                type="date"
                defaultValue={r.starts_on}
                required
              />
            </label>
            <label>
              {t("退房")}
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
              {t("人数")}
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
              {t("状态")}
              <select name="status" defaultValue={r.status}>
                <option value="pending">{t("待确认")}</option><option value="approved">{t("已确认")}</option><option value="rejected">{t("已拒绝")}</option><option value="cancelled">{t("已取消")}</option>
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
              {t("可以睡 sofa")}
            </label>
            <label className="check">
              <input
                name="accepts_air_mattress"
                type="checkbox"
                defaultChecked={Boolean(r.accepts_air_mattress)}
              />{" "}
              {t("接受隐藏备用位")}
            </label>
            </>:null}
            <label className="check">
              <input
                name="exclusive"
                type="checkbox"
                defaultChecked={Boolean(r.exclusive)}
              />{" "}
              {t("独占住宿")}
            </label>
          </div>
          <fieldset className="allocation-editor">
            <legend>{t("床位分配")}</legend>
            <label>
              {t("分配方式")}
              <select
                name="allocation_mode"
                value={allocationMode}
                onChange={(event) => setAllocationMode(event.target.value)}
              >
                <option value="manual">{t("保留 / 手动调整")}</option><option value="auto">{t("按当前规则自动重新分配")}</option>
              </select>
            </label>
            <p className="muted">
              {t("仅“已确认”状态会占用床位；手动分配的人数之和必须等于住宿人数。")}
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
                          {t("容量")} {resource.capacity}{resource.requires_sofa_consent ? ` · ${t("需接受 sofa")}` : ""}{resource.admin_only ? ` · ${t("隐藏备用位")}` : ""}
                        </small>
                      </span>
                      <input
                        aria-label={locale==="en"?`${resource.name} assigned people`:`${resource.name} 分配人数`}
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
                {resources.length === 0 && <p className="muted">{t("这个住宿还没有可用睡位。")}</p>}
              </div>
            )}
          </fieldset>
          <label>
            {t("备注")}
            <textarea
              name="note"
              rows={2}
              defaultValue={r.note}
              maxLength={1000}
            />
          </label>
          <button className="primary">{t("保存修改并重新检查")}</button>
        </form>
        <form
          action={deleteRequest}
          className="danger-zone"
          onSubmit={(event) => {
            if (
              !window.confirm(
                locale==="en"?`Permanently delete ${r.guest_name}'s stay record? Assigned spaces will be released and the private link invalidated.`:`确定永久删除 ${r.guest_name} 的这条住宿记录吗？对应床位会立即释放，私密链接也会失效。`,
              )
            )
              event.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={r.id} />
          <span>
            <b>{t("删除并释放")}</b><small>{t("永久删除记录，并立即释放已安排的床位。")}</small>
          </span>
          <button className="danger-button">{t("删除记录")}</button>
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
  const { t } = useI18n();
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
      title={t("申请与住宿记录")} description={t("先处理待确认申请，再查看即将入住和历史记录。")} count={pendingCount ? `${pendingCount} ${t("个待处理")}` : `${current.length} ${t("个当前记录")}`}
      defaultOpen
    >
      <div className="request-list">
        {current.length === 0 && (
          <p className="empty">{t("目前没有待处理或未来住宿记录。")}</p>
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
            Archive · {t("历史住宿记录")} <span>{archived.length}</span>
          </summary>
          <div className="archive-tools">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("搜索昵称、住宿或日期…")} aria-label={t("搜索历史住宿记录")}
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label={t("筛选历史记录状态")}
            >
              <option value="all">{t("全部状态")}</option><option value="approved">{t("已确认")}</option><option value="rejected">{t("已拒绝")}</option><option value="cancelled">{t("已取消")}</option><option value="pending">{t("待确认")}</option>
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
              <p className="empty">{t("没有找到符合条件的历史记录。")}</p>
            )}
          </div>
        </details>
      )}
    </AdminPanel>
  );
}
