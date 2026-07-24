import Link from "next/link";
import { redirect } from "next/navigation";
import { cancelInviteRequest } from "@/app/actions";
import { switchKey } from "@/app/actions";
import { getGroupAccess } from "@/lib/auth";
import { listRequestsForInvite } from "@/lib/db";
import { getI18n } from "@/lib/i18n-server";
import SubmitButton from "@/app/submit-button";

export const dynamic="force-dynamic";
export default async function MyRequests({searchParams}:{searchParams:Promise<{cancelled?:string}>}){
  const { locale, t }=await getI18n();
  const labels:Record<string,string>={pending:t("待确认"),approved:t("已确认"),rejected:t("已拒绝"),cancelled:t("已取消")};
  const access=await getGroupAccess();
  if(!access?.inviteKeyId)redirect("/");
  const requests=listRequestsForInvite(access.inviteKeyId),query=await searchParams;
  return <main className="center"><article className="receipt my-requests">
    <Link href="/" className="brand">booking.jc</Link>
    <p className="eyebrow">PERSONAL KEY</p><h1>{locale==="en"?`${access.guestName}'s requests`:`${access.guestName} 的申请`}</h1>
    <p className="muted">{t("这里集中显示由你的个人 Key 提交的全部住宿申请。")}</p>
    {query.cancelled&&<p className="alert">{t("申请已取消，对应床位已经释放。")}</p>}
    {requests.length===0?<p>{t("还没有用这枚 Key 提交过申请。")}</p>:<div className="personal-request-list">{requests.map(r=><section key={r.id}>
      <div><span className={`status ${r.status}`}>{labels[r.status]??r.status}</span><h2>{r.stay_name}</h2></div>
      <p>{t("入住")} {r.starts_on} → {t("退房")} {r.ends_on} · {r.party_size} {t("人")}{r.exclusive?` · 🔒 ${t("独占申请")}`:""}</p>
      {r.allocation&&<p className="muted">{t("安排")}：{r.allocation}</p>}
      {['pending','approved'].includes(r.status)&&<form action={cancelInviteRequest}><input type="hidden" name="id" value={r.id}/><SubmitButton pendingLabel={t("取消中…")} confirmMessage={t("确定取消这条申请并释放床位吗？")}>{t("取消这条申请")}</SubmitButton></form>}
    </section>)}</div>}
    <div className="request-actions">
      <Link href="/">← {t("返回日历")}</Link>
      <a href="/my-requests/calendar.ics">{t("导出我的日历")}</a>
      <form action={switchKey}><button>{t("更换 Key")}</button></form>
    </div>
  </article></main>;
}
