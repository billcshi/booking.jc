import Link from "next/link";
import { redirect } from "next/navigation";
import { cancelInviteRequest } from "@/app/actions";
import { switchKey } from "@/app/actions";
import { getGroupAccess } from "@/lib/auth";
import { listRequestsForInvite } from "@/lib/db";

export const dynamic="force-dynamic";
const labels:Record<string,string>={pending:"待确认",approved:"已确认",rejected:"已拒绝",cancelled:"已取消"};

export default async function MyRequests({searchParams}:{searchParams:Promise<{cancelled?:string}>}){
  const access=await getGroupAccess();
  if(!access?.inviteKeyId)redirect("/");
  const requests=listRequestsForInvite(access.inviteKeyId),query=await searchParams;
  return <main className="center"><article className="receipt my-requests">
    <Link href="/" className="brand">booking.jc</Link>
    <p className="eyebrow">PERSONAL KEY</p><h1>{access.guestName} 的申请</h1>
    <p className="muted">这里集中显示由你的个人 Key 提交的全部住宿申请。</p>
    {query.cancelled&&<p className="alert">申请已取消，对应床位已经释放。</p>}
    {requests.length===0?<p>还没有用这枚 Key 提交过申请。</p>:<div className="personal-request-list">{requests.map(r=><section key={r.id}>
      <div><span className={`status ${r.status}`}>{labels[r.status]??r.status}</span><h2>{r.stay_name}</h2></div>
      <p>{r.starts_on} 入住 → {r.ends_on} 退房 · {r.party_size} 人{r.exclusive?" · 🔒 独占申请":""}</p>
      {r.allocation&&<p className="muted">安排：{r.allocation}</p>}
      {['pending','approved'].includes(r.status)&&<form action={cancelInviteRequest}><input type="hidden" name="id" value={r.id}/><button>取消这条申请</button></form>}
    </section>)}</div>}
    <div className="request-actions"><Link href="/">← 返回日历</Link><form action={switchKey}><button>更换 Key</button></form></div>
  </article></main>;
}
