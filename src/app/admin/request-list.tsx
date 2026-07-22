"use client";

import { useState } from "react";
import type {
  BookingRequest,
  RequestAllocation,
  StayResource,
} from "@/lib/db";
import { deleteRequest, editRequest, reviewRequestChange, rotateTrackingToken, updateRequest } from "@/app/actions";
import AdminPanel from "./admin-panel";
import { useI18n } from "../locale-provider";
import SubmitButton from "../submit-button";

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
    request.host_note,
    request.change_id,
    request.change_guest_name,
    request.change_starts_on,
    request.change_ends_on,
    request.change_party_size,
    request.change_accepts_sofa,
    request.change_accepts_air_mattress,
    request.change_exclusive,
    request.change_note,
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
          <span className={`status ${r.status}${r.change_id ? " has-change" : ""}`}>
            {r.change_id ? t("已确认 · 有修改请求") : (labels[r.status] ?? r.status)}
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
      {r.change_id && (
        <section className="request-change-review">
          <span className="status pending">{t("修改请求待审批")}</span>
          <h4>{t("住客提交了住宿修改")}</h4>
          <p>
            {t("申请者")}：<b>{r.change_guest_name}</b> · {r.change_party_size} {t("人")}
            {r.change_exclusive ? ` · 🔒 ${t("独占")}` : ""}
          </p>
          <p>
            {r.starts_on} → {r.ends_on}<br />
            <b>{t("改为")}</b> {r.change_starts_on} → {r.change_ends_on}
          </p>
          {r.is_home ? (
            <p>
              Sofa：{r.change_accepts_sofa ? t("可以") : t("不可以")} · {t("隐藏备用位")}：{r.change_accepts_air_mattress ? t("接受") : t("不接受")}
            </p>
          ) : null}
          {r.change_note !== r.note && (
            <p>{t("新住客留言")}：{r.change_note || t("（空）")}</p>
          )}
          <small>{t("批准后才会替换原申请资料，并重新检查和分配床位。")}</small>
          <div>
            <form action={reviewRequestChange}>
              <input type="hidden" name="change_id" value={r.change_id} />
              <input type="hidden" name="decision" value="approve" />
              <SubmitButton className="approve" pendingLabel={t("处理中…")}>{t("批准修改并重新分配")}</SubmitButton>
            </form>
            <form action={reviewRequestChange}>
              <input type="hidden" name="change_id" value={r.change_id} />
              <input type="hidden" name="decision" value="reject" />
              <SubmitButton pendingLabel={t("处理中…")}>{t("拒绝修改")}</SubmitButton>
            </form>
          </div>
        </section>
      )}
      {(r.status==="pending"||r.change_id)&&<p className={r.conflict_preview==="clear"?"success":"alert"} aria-live="polite">{r.conflict_preview==="clear"?t("冲突预览：当前可安排"):r.conflict_preview==="blackout"?t("冲突预览：包含不可住日期"):r.conflict_preview==="exclusive"?t("冲突预览：与独占住宿冲突"):t("冲突预览：当前容量不足")}</p>}
      <div className="request-detail">
        {r.is_home? <>
        <span>Sofa：{r.accepts_sofa ? t("可以") : t("不可以")}</span><span>{t("隐藏备用位")}：{r.accepts_air_mattress ? t("接受") : t("不接受")}</span>
        </>:null}
        {r.allocation && <strong>{t("安排")}：{r.allocation}</strong>}{r.note && <span>{t("住客留言")}：{r.note}</span>}
      </div>
      <details className="edit-request">
        <summary>{t("编辑这条记录")}</summary>
        <div className="tracking-link-actions">
          <button type="button" onClick={copyTrackingLink}>
            {linkCopied ? t("已复制") : t("复制私密链接")}
          </button>
          <a href={trackingPath} target="_blank" rel="noreferrer">
            {t("打开私密链接")}
          </a>
          <form action={rotateTrackingToken}>
            <input type="hidden" name="id" value={r.id} />
            <SubmitButton pendingLabel={t("处理中…")} confirmMessage={t("确定撤销旧私密链接并生成新链接吗？")}>{t("轮换 / 撤销旧链接")}</SubmitButton>
          </form>
          <small>{t("最近访问")}：{r.tracking_last_accessed_at ?? t("从未")}</small>
        </div>
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
            {t("住客留言")}
            <textarea
              name="note"
              rows={2}
              defaultValue={r.note}
              maxLength={1000}
            />
          </label>
          <label>
            {t("Host 私密备注")}
            <textarea
              name="host_note"
              rows={2}
              defaultValue={r.host_note}
              maxLength={1000}
              placeholder={t("只有 Host 可以查看和修改")}
            />
          </label>
          <button className="primary">{t("保存修改并重新检查")}</button>
        </form>
        <form action={deleteRequest} className="danger-zone">
          <input type="hidden" name="id" value={r.id} />
          <span>
            <b>{t("移入回收站并释放")}</b><small>{t("记录可由 Host 恢复；床位会立即释放。")}</small>
          </span>
          <SubmitButton className="danger-button" pendingLabel={t("处理中…")} confirmMessage={locale==="en"?`Move ${r.guest_name}'s stay record to Trash? Assigned spaces will be released.`:`确定把 ${r.guest_name} 的住宿记录移入回收站吗？对应床位会立即释放。`}>{t("移入回收站")}</SubmitButton>
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
  const changeRequests = requests
    .filter((request) => request.change_id)
    .sort((a, b) => (a.change_created_at ?? "").localeCompare(b.change_created_at ?? ""));
  const current = requests.filter((request) => !request.change_id && request.ends_on > today);
  const activeRequests = [...changeRequests, ...current];
  const archived = requests
    .filter((request) => !request.change_id && request.ends_on <= today)
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
  const pendingCount = activeRequests.filter((request) => request.status === "pending" || request.change_id).length;
  return (
    <AdminPanel
      eyebrow="REQUESTS"
      title={t("申请与住宿记录")} description={t("先处理待确认申请，再查看即将入住和历史记录。")} count={pendingCount ? `${pendingCount} ${t("个待处理")}` : `${activeRequests.length} ${t("个当前记录")}`}
      defaultOpen
    >
      <div className="request-list">
        {activeRequests.length === 0 && (
          <p className="empty">{t("目前没有待处理或未来住宿记录。")}</p>
        )}
        {activeRequests.map((r) => {
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
