import Link from "next/link";
import { getSetting, listBlackouts, listStays, publicSchedule } from "@/lib/db";
import BookingCalendar from "./booking-calendar";
import { getGroupAccess } from "@/lib/auth";
import { switchKey } from "./actions";
import { getI18n } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";
function nights(start: string, end: string) {
  const result: string[] = [];
  for (
    let t = Date.parse(`${start}T00:00:00Z`);
    t < Date.parse(`${end}T00:00:00Z`);
    t += 86_400_000
  )
    result.push(new Date(t).toISOString().slice(0, 10));
  return result;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { t } = await getI18n();
  const stays = listStays(),
    requests = publicSchedule(),
    blackouts = listBlackouts(),
    { error } = await searchParams,
    access = await getGroupAccess(),
    unlocked = Boolean(access),
    hostDisplayName = getSetting("host_display_name") ?? "Host";
  const views = stays.map((stay) => {
    const usage: Record<
      string,
      {
        approved: number;
        hiddenApproved: number;
        people: number;
        pending: number;
        guests: Array<{ name: string; size: number }>;
        blocked?: string;
        exclusive?: boolean;
      }
    > = {};
    for (const request of requests.filter((r) => r.stay_id === stay.id)) {
      for (const day of nights(request.starts_on, request.ends_on)) {
        usage[day] ??= { approved: 0, hiddenApproved:0, people: 0, pending: 0, guests: [] };
        if(request.status === "approved"){
          usage[day].approved += request.public_seats;
          usage[day].hiddenApproved += request.hidden_seats;
          usage[day].people += request.party_size;
        }else usage[day].pending += request.party_size;
        if (unlocked && request.status === "approved") {
          usage[day].guests.push({
            name: request.guest_name,
            size: request.party_size,
          });
        }
        if (request.status === "approved") {
          if (request.exclusive) usage[day].exclusive = true;
        }
      }
    }
    for (const block of blackouts.filter((b) => b.stay_id === stay.id)) {
      for (const day of nights(block.starts_on, block.ends_on)) {
        usage[day] ??= { approved: 0, hiddenApproved:0, people: 0, pending: 0, guests: [] };
        usage[day].blocked = unlocked ? block.reason : "Unavailable";
      }
    }
    return { ...stay, location: unlocked ? stay.location : "", nights: usage };
  });
  return (
    <main>
      <header className="calendar-hero">
        <div className="wrap">
          <nav>
            <span className="brand">booking.jc</span>
            {access?.inviteKeyId && <Link href="/my-requests">{t("我的申请")}</Link>}
            {access&&<form action={switchKey}><button type="submit" className="nav-link">{t("更换 Key")}</button></form>}
            <Link href="/admin">Host</Link>
          </nav>
          <div className="hero-copy">
            <div>
              <p className="eyebrow">A PLACE FOR FRIENDS</p>
              <h1>{t("选你要住的晚上")}</h1>
            </div>
            <p>{t("点日期看谁会来，再选择入住和退房。")}</p>
          </div>
        </div>
      </header>
      <section className="wrap calendar-section">
        {error && !unlocked && (
          <p className="alert">
            {error === "key"
              ? t("Key code 不正确或已停用。")
              : error === "rate"
                ? t("尝试次数太多，请稍后再试。")
                : t("请先输入 key code 解锁。")}
          </p>
        )}
        <BookingCalendar
          stays={views}
          error={error}
          unlocked={unlocked}
          guestName={access?.guestName ?? ""}
          hostDisplayName={hostDisplayName}
          timeZone={process.env.APP_TIME_ZONE ?? "UTC"}
        />
      </section>
    </main>
  );
}
