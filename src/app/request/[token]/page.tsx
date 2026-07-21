import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { cancelOwnRequest } from "@/app/actions";
import { getI18n } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";
export default async function RequestPage({ params, searchParams }: { params: Promise<{token:string}>; searchParams: Promise<{created?:string; cancelled?:string}> }) {
  const { token } = await params, query = await searchParams, { t } = await getI18n();
  const r = db.prepare(`SELECT q.*,s.name stay_name,GROUP_CONCAT(resources.name || ' × ' || allocations.seats, ', ') allocation FROM requests q JOIN stays s ON s.id=q.stay_id LEFT JOIN allocations ON allocations.request_id=q.id LEFT JOIN resources ON resources.id=allocations.resource_id WHERE q.manage_token=? GROUP BY q.id`).get(token) as Record<string,string>|undefined;
  if (!r) notFound();
  const cancel = cancelOwnRequest.bind(null, token);
  return <main className="center"><article className="receipt"><Link href="/" className="brand">booking.jc</Link><span className={`status ${r.status}`}>{r.status}</span><h1>{t(query.created?"Request received.":query.cancelled?"Request cancelled.":"Your stay request")}</h1><p>{r.stay_name}</p><dl><div><dt>{t("Dates")}</dt><dd>{r.starts_on} → {r.ends_on}</dd></div><div><dt>{t("Party")}</dt><dd>{r.party_size} {t("人")}</dd></div>{Number(r.exclusive)===1&&<div><dt>{t("Stay type")}</dt><dd>🔒 {t("希望独占住宿")}</dd></div>}{r.allocation&&<div><dt>{t("Arrangement")}</dt><dd>{r.allocation}</dd></div>}</dl><p className="muted">{t("保存这个私密链接，用来回来查看状态或取消申请。")}</p>{!['cancelled','rejected'].includes(r.status)&&<form action={cancel}><button>{t("Cancel request")}</button></form>}</article></main>;
}
