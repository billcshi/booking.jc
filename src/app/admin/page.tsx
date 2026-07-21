import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/auth";
import {
  getSetting,
  listBlackouts,
  listInviteKeys,
  listRequestAllocations,
  listRequests,
  listStays,
  listStayResources,
} from "@/lib/db";
import { addGuestDirectly, logout } from "@/app/actions";
import BlackoutManager from "./blackout-manager";
import GroupKeyManager from "./group-key-manager";
import RequestList from "./request-list";
import TripManager from "./trip-manager";
import HomeManager from "./home-manager";
import AdminPanel from "./admin-panel";
import { getI18n } from "@/lib/i18n-server";
export const dynamic = "force-dynamic";
function todayInAppTimeZone() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIME_ZONE ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    added?: string;
    blocked?: string;
    key_reset?: string;
    invite_created?: string;
    invite_reset?: string;
    edited?: string;
    stay_edited?: string;
    stay_deleted?: string;
    request_deleted?: string;
    home_updated?: string;
  }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { locale, t } = await getI18n(), en = locale === "en";
  const requests = listRequests(),
    stays = listStays(),
    resources = listStayResources(),
    allocations = listRequestAllocations(),
    blackouts = listBlackouts(),
    inviteKeys = listInviteKeys(),
    groupKey = getSetting("group_key") ?? "",
    hostDisplayName = getSetting("host_display_name") ?? "Host",
    {
      error,
      added,
      blocked,
      key_reset,
      invite_created,
      invite_reset,
      stay_edited,
      stay_deleted,
      request_deleted,
      home_updated,
    } = await searchParams;
  const errorMessages: Record<string,{zh:string;en:string}> = {
    key_format:{zh:"Key code 必须是 4–64 位，只能使用字母、数字、点、下划线和连字符。",en:"Key codes must be 4–64 characters using letters, numbers, dots, underscores, or hyphens."},
    key_conflict:{zh:"这个 Key code 已经在使用，请换一个。",en:"This key code is already in use."}, name:{zh:"请填写姓名或昵称。",en:"Enter a name or nickname."},
    allocation:{zh:"手动床位分配必须使用该住宿的可用睡位，且分配人数之和必须等于住宿人数。",en:"Manual assignments must use this stay's spaces and add up to the party size."},
    request_bounds:{zh:"这条记录的入住日期超出了当前旅行住宿范围，请先调整记录日期。",en:"This request falls outside the trip dates."}, dates:{zh:"退房日期必须晚于入住日期。",en:"Check-out must be after check-in."},
    range:{zh:"一次历史补录最多支持 10 年。",en:"A historical entry may span at most 10 years."}, people:{zh:"人数必须是 1–8 人。",en:"Party size must be 1–8."}, trip_form:{zh:"请检查旅行名称、地点和日期。",en:"Check the trip name, location, and dates."},
    trip_dates:{zh:"旅行日期不能排除已有申请或不可住记录。",en:"Trip dates cannot exclude existing requests or unavailable periods."}, trip_resources:{zh:"请按“睡位名称 | 人数”填写，每个睡位支持 1–8 人。",en:"Enter each space as name | capacity, with capacity 1–8."},
    trip_capacity:{zh:"正在使用的睡位不能删除，容量也不能低于现有分配。",en:"In-use spaces cannot be removed or reduced below current assignments."}, home_form:{zh:"请检查 Host 显示名、固定住所名称和地点。",en:"Check the host display name, home name, and location."},
    home_resources:{zh:"请至少保留一个公开睡位，并检查名称、容量和选项。",en:"Keep at least one public sleeping space and check its settings."}, home_capacity:{zh:"已有分配的睡位不能删除，容量也不能低于其历史峰值。",en:"Assigned spaces cannot be removed or reduced below their historical peak."},
    trip_active:{zh:"该旅行仍有待确认或已确认住客；请先取消或拒绝这些记录，再删除旅行。",en:"This trip still has pending or approved guests."}, form:{zh:"请检查填写内容。",en:"Check the form details."}, blocked:{zh:"所选日期包含不可住时段。",en:"The selected dates include an unavailable period."},
    capacity:{zh:"空间不足，或与已有独占住宿冲突；请先调整其他预约。",en:"Not enough capacity, or the stay conflicts with an exclusive booking."},
  };
  const selectedError=errorMessages[error??"capacity"]??errorMessages.capacity, errorMessage=en?selectedError.en:selectedError.zh;
  const today = todayInAppTimeZone();
  const home = stays.find((stay) => !stay.starts_on && !stay.ends_on);
  const homeResources = home
    ? resources.filter((resource) => resource.stay_id === home.id)
    : [];
  const homeEditorVersion = home
    ? JSON.stringify([
        home.id,
        home.name,
        home.location,
        hostDisplayName,
        homeResources.map((resource) => [
          resource.id,
          resource.name,
          resource.capacity,
          resource.priority,
          resource.admin_only,
          resource.requires_sofa_consent,
        ]),
      ])
    : "";
  return (
    <main className="admin">
      <header className="admin-nav">
        <Link href="/" className="brand">
          booking.jc
        </Link>
        <form action={logout}>
          <button className="link-button">{t("退出")}</button>
        </form>
      </header>
      <div className="admin-wrap">
        <div className="admin-title">
          <div>
            <p className="eyebrow">HOST DESK</p>
            <h1>{t("住宿管理")}</h1>
          </div>
        </div>
        {error && <p className="alert">{errorMessage}</p>}
        {added && <p className="success">{t("住客已直接加入并自动安排位置。")}</p>}{stay_edited && <p className="success">{t("旅行住宿已更新。")}</p>}{stay_deleted && <p className="success">{t("临时旅行住宿已删除。")}</p>}{request_deleted && <p className="success">{t("住宿记录已删除，对应床位已经释放。")}</p>}{home_updated && <p className="success">{t("固定住所和睡位设置已更新。")}</p>}{blocked && <p className="success">{t("关闭时段已保存。")}</p>}
        <div className="admin-panels">
          <RequestList
            requests={requests}
            resources={resources}
            allocations={allocations}
            today={today}
          />

          <AdminPanel
            eyebrow="QUICK ADD"
            title={t("直接安排住客")} description={t("录入未来安排或补录历史住宿，无需经过公开申请流程。")}
          >
            <form action={addGuestDirectly}>
              <div className="row">
                <label>
                  {t("住宿")}
                  <select name="stay_id" required>
                    {stays.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("姓名 / 群昵称")}
                  <input name="guest_name" required maxLength={80} />
                </label>
              </div>
              <div className="row">
                <label>
                  {t("入住")}
                  <input name="starts_on" type="date" required />
                </label>
                <label>
                  {t("退房")}
                  <input name="ends_on" type="date" required />
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
                    defaultValue="1"
                    required
                  />
                </label>
                <div>
                  <label className="check admin-check">
                    <input name="accepts_sofa" type="checkbox" /> {t("可以安排需 sofa 同意的睡位（仅固定住所）")}
                  </label>
                  <label className="check admin-check">
                    <input name="accepts_air_mattress" type="checkbox" /> {t("可以安排隐藏备用位（仅固定住所）")}
                  </label>
                  <label className="check">
                    <input name="exclusive" type="checkbox" /> {t("独占住宿，不接待其他人")}
                  </label>
                </div>
              </div>
              <label>
                {t("内部备注（可选）")}
                <input name="note" maxLength={500} />
              </label>
              <button className="primary">{t("直接加入并安排")}</button>
            </form>
          </AdminPanel>

          {home && (
            <HomeManager
              key={homeEditorVersion}
              home={home}
              resources={homeResources}
              hostDisplayName={hostDisplayName}
            />
          )}
          <BlackoutManager stays={stays} blackouts={blackouts} />
          <TripManager stays={stays} resources={resources} today={today} />
          <GroupKeyManager
            groupKey={groupKey}
            inviteKeys={inviteKeys}
            reset={Boolean(key_reset)}
            inviteCreated={Boolean(invite_created)}
            inviteReset={Boolean(invite_reset)}
          />
        </div>
      </div>
    </main>
  );
}
