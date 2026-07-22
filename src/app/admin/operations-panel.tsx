"use client";

import type { AuditLog, BookingRequest } from "@/lib/db";
import { permanentlyDeleteRequest, resetCalendarFeed, restoreRequest } from "@/app/actions";
import AdminPanel from "./admin-panel";
import SubmitButton from "../submit-button";
import { useI18n } from "../locale-provider";

export default function OperationsPanel({logs,trash,feedToken}:{logs:AuditLog[];trash:BookingRequest[];feedToken:string}){
  const {t}=useI18n();
  return <AdminPanel eyebrow="OPERATIONS" title={t("审计、导出与回收站")} description={t("私密工具只对已登录 Host 开放。") }>
    <div className="tracking-link-actions">
      <a href="/admin/export.csv">CSV</a><a href="/admin/export.json">JSON</a><a href="/admin/health">Health</a>
      <a href={`/calendar/${feedToken}.ics`}>{t("私密日历订阅")}</a>
      <form action={resetCalendarFeed}><SubmitButton pendingLabel={t("处理中…")} confirmMessage={t("确定撤销旧日历订阅地址吗？")}>{t("轮换日历订阅地址")}</SubmitButton></form>
    </div>
    <details><summary>{t("回收站")} · {trash.length}</summary>
      {trash.map(r=><div key={r.id} className="danger-zone"><span><b>{r.guest_name}</b><small>{r.stay_name} · {r.starts_on} → {r.ends_on}</small></span><div className="tracking-link-actions"><form action={restoreRequest}><input type="hidden" name="id" value={r.id}/><SubmitButton pendingLabel={t("处理中…")}>{t("恢复并重新检查床位")}</SubmitButton></form><form action={permanentlyDeleteRequest}><input type="hidden" name="id" value={r.id}/><SubmitButton className="danger-button" pendingLabel={t("删除中…")} confirmMessage={t("确定永久删除这条记录吗？此操作无法撤销。")}>{t("永久删除")}</SubmitButton></form></div></div>)}
      {!trash.length&&<p className="muted">{t("回收站为空。")}</p>}
    </details>
    <details><summary>{t("管理操作审计日志")} · {logs.length}</summary>
      <ol>{logs.map(log=><li key={log.id}><time>{log.created_at}</time> · <code>{log.action}</code> · {log.entity_type}{log.entity_id?` #${log.entity_id}`:""}</li>)}</ol>
    </details>
  </AdminPanel>;
}
