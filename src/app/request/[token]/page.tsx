import { notFound } from "next/navigation";
import Link from "next/link";
import { cancelOwnRequest, editOwnRequest } from "@/app/actions";
import { db } from "@/lib/db";
import { getI18n } from "@/lib/i18n-server";
import SubmitButton from "@/app/submit-button";

export const dynamic = "force-dynamic";

type TrackedRequest = {
  id: number;
  guest_name: string;
  starts_on: string;
  ends_on: string;
  party_size: number;
  accepts_sofa: number;
  accepts_air_mattress: number;
  exclusive: number;
  note: string;
  status: string;
  stay_name: string;
  is_home: number;
  allocation: string | null;
  change_id: number | null;
  change_guest_name: string | null;
  change_starts_on: string | null;
  change_ends_on: string | null;
  change_party_size: number | null;
  change_accepts_sofa: number | null;
  change_accepts_air_mattress: number | null;
  change_exclusive: number | null;
  change_note: string | null;
};

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    created?: string;
    cancelled?: string;
    updated?: string;
    change_requested?: string;
    error?: string;
  }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const { t } = await getI18n();
  const request = db.prepare(`SELECT q.id,q.guest_name,q.starts_on,q.ends_on,q.party_size,
    q.accepts_sofa,q.accepts_air_mattress,q.exclusive,q.note,q.status,s.name stay_name,
    CASE WHEN s.starts_on IS NULL AND s.ends_on IS NULL THEN 1 ELSE 0 END is_home,
    GROUP_CONCAT(resources.name || ' × ' || allocations.seats, ', ') allocation,
    c.id change_id,c.guest_name change_guest_name,c.starts_on change_starts_on,c.ends_on change_ends_on,
    c.party_size change_party_size,c.accepts_sofa change_accepts_sofa,
    c.accepts_air_mattress change_accepts_air_mattress,c.exclusive change_exclusive,c.note change_note
    FROM requests q JOIN stays s ON s.id=q.stay_id
    LEFT JOIN allocations ON allocations.request_id=q.id
    LEFT JOIN resources ON resources.id=allocations.resource_id
    LEFT JOIN request_changes c ON c.request_id=q.id AND c.status='pending'
    WHERE q.manage_token=? GROUP BY q.id`).get(token) as TrackedRequest | undefined;
  if (!request) notFound();

  const cancel = cancelOwnRequest.bind(null, token);
  const edit = editOwnRequest.bind(null, token);
  const labels: Record<string, string> = {
    pending: t("待确认"),
    approved: t("已确认"),
    rejected: t("已拒绝"),
    cancelled: t("已取消"),
  };
  const editable = ["pending", "approved", "rejected"].includes(request.status);
  const proposedGuest = request.change_guest_name ?? request.guest_name;
  const proposedStart = request.change_starts_on ?? request.starts_on;
  const proposedEnd = request.change_ends_on ?? request.ends_on;
  const proposedSize = request.change_party_size ?? request.party_size;
  const proposedSofa = request.change_accepts_sofa ?? request.accepts_sofa;
  const proposedAirMattress = request.change_accepts_air_mattress ?? request.accepts_air_mattress;
  const proposedExclusive = request.change_exclusive ?? request.exclusive;
  const proposedNote = request.change_note ?? request.note;

  return (
    <main className="center">
      <article className="receipt request-receipt">
        <Link href="/" className="brand">booking.jc</Link>
        <span className={`status ${request.status}`}>
          {labels[request.status] ?? request.status}
        </span>
        <h1>
          {t(query.created ? "Request received." : query.cancelled ? "Request cancelled." : "Your stay request")}
        </h1>
        <p>{request.stay_name}</p>
        {query.updated && <p className="success">{t("申请信息已更新。")}</p>}
        {query.change_requested && <p className="success">{t("申请修改已提交给 Host 审批；原住宿安排暂时保持不变。")}</p>}
        {query.error && (
          <p className="alert">
            {query.error === "rate" ? t("尝试次数太多，请稍后再试。") : t("无法保存修改，请检查日期和填写内容。")}
          </p>
        )}
        <dl>
          <div><dt>{t("申请者")}</dt><dd>{request.guest_name}</dd></div>
          <div><dt>{t("Dates")}</dt><dd>{request.starts_on} → {request.ends_on}</dd></div>
          <div><dt>{t("Party")}</dt><dd>{request.party_size} {t("人")}</dd></div>
          {request.is_home === 1 && (
            <>
              <div><dt>Sofa</dt><dd>{request.accepts_sofa ? t("可以") : t("不可以")}</dd></div>
              <div><dt>{t("隐藏备用位")}</dt><dd>{request.accepts_air_mattress ? t("接受") : t("不接受")}</dd></div>
            </>
          )}
          {request.exclusive === 1 && <div><dt>{t("Stay type")}</dt><dd>🔒 {t("希望独占住宿")}</dd></div>}
          {request.allocation && <div><dt>{t("Arrangement")}</dt><dd>{request.allocation}</dd></div>}
          {request.note && <div><dt>{t("住客留言")}</dt><dd>{request.note}</dd></div>}
        </dl>

        {request.change_id && (
          <section className="pending-change-summary">
            <span className="status pending">{t("修改待审批")}</span>
            <p><b>{request.change_guest_name}</b> · {request.change_party_size} {t("人")}</p>
            <p>{t("申请改为")} <b>{request.change_starts_on} → {request.change_ends_on}</b></p>
            <small>{t("审批前仍保留上方的原日期和床位安排。")}</small>
          </section>
        )}

        {editable && (
          <details className="request-self-edit">
            <summary>{t("修改日期或留言")}</summary>
            <form action={edit}>
              <label>
                {t("申请者")}
                <input name="guest_name" defaultValue={proposedGuest} required maxLength={80} />
              </label>
              <div className="row">
                <label>
                  {t("入住")}
                  <input name="starts_on" type="date" defaultValue={proposedStart} required />
                </label>
                <label>
                  {t("退房")}
                  <input name="ends_on" type="date" defaultValue={proposedEnd} required />
                </label>
              </div>
              <label>
                {t("人数")}
                <input name="party_size" type="number" min="1" max="8" defaultValue={proposedSize} required />
              </label>
              {request.is_home === 1 && (
                <div className="request-option-list">
                  <label className="check">
                    <input name="accepts_sofa" type="checkbox" defaultChecked={Boolean(proposedSofa)} />
                    {t("可以睡 sofa")}
                  </label>
                  <label className="check">
                    <input name="accepts_air_mattress" type="checkbox" defaultChecked={Boolean(proposedAirMattress)} />
                    {t("接受隐藏备用位")}
                  </label>
                </div>
              )}
              <label className="check">
                <input name="exclusive" type="checkbox" defaultChecked={Boolean(proposedExclusive)} />
                {t("希望独占住宿")}
              </label>
              <label>
                {t("给 Host 的留言（可选）")}
                <textarea name="note" rows={3} maxLength={1000} defaultValue={proposedNote} />
              </label>
              <p className="muted">
                {request.status === "approved"
                  ? t("已确认申请修改姓名、日期、人数或住宿选项后需要 Host 再次批准；只修改留言会立即保存。")
                  : request.status === "rejected"
                    ? t("保存后，这条申请会重新进入待确认状态。")
                    : t("待确认申请的资料会直接更新。")}
              </p>
              <SubmitButton className="primary" pendingLabel={t("保存中…")}>{t("保存修改")}</SubmitButton>
            </form>
          </details>
        )}

        <p className="muted">{t("保存这个私密链接，用来回来查看状态或取消申请。")}</p>
        {!['cancelled','rejected'].includes(request.status) && (
          <form action={cancel} className="cancel-request-form">
            <button>{t("Cancel request")}</button>
          </form>
        )}
      </article>
    </main>
  );
}
