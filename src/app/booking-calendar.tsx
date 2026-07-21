"use client";

import { useState } from "react";
import { submitRequest, unlockGroup } from "./actions";

type Night = {
  approved: number;
  hiddenApproved: number;
  people: number;
  pending: number;
  guests: Array<{ name: string; size: number }>;
  blocked?: string;
  exclusive?: boolean;
};
type StayView = {
  id: number;
  name: string;
  location: string;
  starts_on: string | null;
  ends_on: string | null;
  total_capacity: number;
  hidden_capacity: number;
  sofa_capacity: number;
  nights: Record<string, Night>;
};
const DAY = 86_400_000;
const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}
function add(date: string, days: number) {
  return iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY));
}
function localToday(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function monthOf(date: string) {
  return date.slice(0, 7);
}
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthGrid(month: string) {
  const first = `${month}-01`,
    offset = new Date(`${first}T00:00:00Z`).getUTCDay(),
    start = add(first, -offset);
  return Array.from({ length: 42 }, (_, i) => add(start, i));
}
function pretty(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export default function BookingCalendar({
  stays,
  error,
  unlocked,
  guestName,
  hostDisplayName,
  timeZone,
}: {
  stays: StayView[];
  error?: string;
  unlocked: boolean;
  guestName: string;
  hostDisplayName: string;
  timeZone: string;
}) {
  const [stayId, setStayId] = useState(stays[0]?.id ?? 0),
    stay = stays.find((x) => x.id === stayId) ?? stays[0];
  const today = localToday(timeZone);
  const initialFocus = stay?.starts_on ?? today,
    initial = monthOf(initialFocus);
  const [month, setMonth] = useState(initial),
    [focus, setFocus] = useState(initialFocus),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [acceptsAirMattress,setAcceptsAirMattress]=useState(false),
    [showHistory, setShowHistory] = useState(
      Boolean(stay?.starts_on && stay.starts_on < today),
    );
  if (!stay) return null;
  const cells = monthGrid(month),
    night = stay.nights[focus] ?? { approved: 0, hiddenApproved:0, people: 0, pending: 0, guests: [] },
    remaining = Math.max(0, stay.total_capacity - night.approved),
    isTrip = Boolean(stay.starts_on && stay.ends_on),
    tripStartMonth = stay.starts_on ? monthOf(stay.starts_on) : null,
    tripEndMonth = stay.ends_on ? monthOf(stay.ends_on) : null;
  function switchStay(id: number) {
    const next = stays.find((x) => x.id === id)!;
    setStayId(id);
    setStart("");
    setEnd("");
    const d = next.starts_on ?? today;
    setMonth(monthOf(d));
    setFocus(d);
    setShowHistory(Boolean(next.starts_on && next.starts_on < today));
  }
  function inTripNight(day: string) {
    return (
      !isTrip ||
      Boolean(
        stay.starts_on &&
        stay.ends_on &&
        day >= stay.starts_on &&
        day < stay.ends_on,
      )
    );
  }
  function isTripDeparture(day: string) {
    return Boolean(isTrip && stay.ends_on === day);
  }
  function canStay(day: string) {
    if (day < today) return false;
    if (stay.starts_on && day < stay.starts_on) return false;
    if (stay.ends_on && day >= stay.ends_on) return false;
    if (stay.nights[day]?.blocked || stay.nights[day]?.exclusive) return false;
    const use=stay.nights[day];
    const regularAvailable=(use?.approved??0)<stay.total_capacity;
    const mattressAvailable=!isTrip&&acceptsAirMattress&&(use?.hiddenApproved??0)<stay.hidden_capacity;
    return regularAvailable||mattressAvailable;
  }
  function canEndAt(day: string) {
    if (!start || day <= start || Boolean(stay.ends_on && day > stay.ends_on))
      return false;
    for (let night = start; night < day; night = add(night, 1)) {
      if (!canStay(night)) return false;
    }
    return true;
  }
  function pickDate(day: string) {
    setFocus(day);
    if (day < today || (!inTripNight(day) && !isTripDeparture(day))) return;
    if (!start || end || day <= start) {
      if (canStay(day)) {
        setStart(day);
        setEnd("");
      }
      return;
    }
    if (canEndAt(day)) setEnd(day);
  }
  return (
    <div className="booking-shell">
      <div className="stay-tabs">
        {stays.map((s) => (
          <button
            type="button"
            className={s.id === stay.id ? "active" : ""}
            onClick={() => switchStay(s.id)}
            key={s.id}
          >
            <b>{s.name}</b>
            <span>{s.location}</span>
          </button>
        ))}
      </div>
      <p className="stay-summary">
        <b>{stay.total_capacity} 个睡位</b> ·{" "}
        {isTrip
          ? `${pretty(stay.starts_on!)} → ${pretty(stay.ends_on!)} · 仅行程日期可预约`
          : "固定住所 · 睡位由管理员维护"}{" "}
        · 退房日不占床位
      </p>
      <div className="heat-legend">
        <span className="empty">空</span>
        <span className="low">少量占用</span>
        <span className="high">接近满</span>
        <span className="full">已满</span>
        <span className="exclusive">独占</span>
        <span className="blocked">不可住</span>
        {isTrip && <span className="outside">非行程</span>}
      </div>
      <div className="month-layout">
        <div className="month-main">
          <div className="month-toolbar">
            <div>
              <button
                type="button"
                onClick={() => setMonth(shiftMonth(month, -1))}
                disabled={
                  isTrip
                    ? Boolean(
                        tripStartMonth &&
                        shiftMonth(month, -1) < tripStartMonth,
                      )
                    : !showHistory && shiftMonth(month, -1) < monthOf(today)
                }
                aria-label="上个月"
              >
                ‹
              </button>
              <h2>{month.replace("-", " 年 ")} 月</h2>
              <button
                type="button"
                onClick={() => setMonth(shiftMonth(month, 1))}
                disabled={
                  isTrip
                    ? Boolean(
                        tripEndMonth && shiftMonth(month, 1) > tripEndMonth,
                      )
                    : false
                }
                aria-label="下个月"
              >
                ›
              </button>
            </div>
            <div className="history-tools">
              {!isTrip && (
                <button
                  type="button"
                  onClick={() => {
                    setShowHistory(!showHistory);
                    if (showHistory) {
                      setMonth(monthOf(today));
                      setFocus(today);
                    }
                  }}
                >
                  {showHistory ? "返回未来" : "查看历史"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const d = stay.starts_on ?? today;
                  setMonth(monthOf(d));
                  setFocus(d);
                }}
              >
                {isTrip ? "行程日期" : "今天"}
              </button>
            </div>
          </div>
          <div className="range-hint">
            {!start
              ? "点击入住日，再点击退房日"
              : end
                ? "日期范围已选好；点击其他日期可重新选择"
                : `入住：${pretty(start)} · 现在点击退房日`}
          </div>
          {start && (
            <div className="range-bar">
              <span>
                {end
                  ? `${pretty(start)} 入住 → ${pretty(end)} 退房 · ${Math.round((Date.parse(end) - Date.parse(start)) / DAY)} 晚`
                  : `已选 ${pretty(start)} 入住，请再点退房日`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setStart("");
                  setEnd("");
                }}
              >
                清除
              </button>
            </div>
          )}
          <div className="weekday-row">
            {weekdays.map((x) => (
              <span key={x}>周{x}</span>
            ))}
          </div>
          <div className="natural-calendar">
            {cells.map((day) => {
              const use = stay.nights[day] ?? {
                  approved: 0,
                  hiddenApproved:0,
                  people: 0,
                  pending: 0,
                  guests: [],
                },
                left = use.exclusive
                  ? 0
                  : Math.max(0, stay.total_capacity - use.approved),
                overflowOnly=left===0&&acceptsAirMattress&&use.hiddenApproved<stay.hidden_capacity&&!use.blocked&&!use.exclusive,
                other = monthOf(day) !== month,
                past = day < today,
                selected = day === focus,
                inRange =
                  start &&
                  (day === start ||
                    day === end ||
                    Boolean(end && day > start && day < end)),
                ratio = use.approved / stay.total_capacity,
                outsideTrip = !inTripNight(day) && !isTripDeparture(day),
                departure = isTripDeparture(day),
                tier = outsideTrip
                  ? "outside-trip"
                  : departure
                    ? "trip-departure"
                    : use.blocked
                      ? "is-blocked"
                      : use.exclusive
                        ? "is-exclusive"
                        : ratio >= 1
                          ? "occupancy-full"
                          : ratio >= 0.66
                            ? "occupancy-high"
                            : ratio > 0
                              ? "occupancy-low"
                              : "occupancy-empty";
              return (
                <button
                  type="button"
                  key={day}
                  disabled={outsideTrip || (!showHistory && past)}
                  onClick={() => pickDate(day)}
                  className={`${other ? "other-month " : ""}${past && !showHistory ? "past-hidden " : ""}${selected ? "focused " : ""}${inRange ? "in-range " : ""}${day === start ? "range-start " : ""}${day === end ? "range-end " : ""}${tier}`}
                  aria-label={`${pretty(day)}，${outsideTrip ? "非此次行程" : departure ? "退房日" : use.blocked ? "不可住" : use.exclusive ? "独占住宿" : left ? `余${left}位` : overflowOnly ? "常规床位已满，隐藏备用位可用" : "已满"}${outsideTrip || departure ? "" : `，${use.pending}人待确认`}`}
                >
                  <strong>{Number(day.slice(-2))}</strong>
                  <small>
                    {outsideTrip
                      ? "— 非行程"
                      : departure
                        ? "↗ 退房日"
                        : use.blocked
                          ? "× 不可住"
                          : use.exclusive
                            ? "🔒 独占"
                            : left
                              ? `✓ 余 ${left}`
                              : overflowOnly
                                ? "＋ 备用位"
                                : "— 已满"}
                  </small>
                  {day === start && <b className="range-label">入住</b>}
                  {day === end && <b className="range-label">退房</b>}
                  {!outsideTrip &&
                    !departure &&
                    !use.blocked &&
                    !use.exclusive && (
                      <span className="occupancy-meter">
                        <i
                          style={{ width: `${Math.min(100, ratio * 100)}%` }}
                        />
                      </span>
                    )}
                  {!outsideTrip &&
                    !departure &&
                    !use.blocked &&
                    (unlocked && use.guests.length > 0 ? (
                      <span className="avatar-stack">
                        {use.guests.slice(0, 2).map((g, i) => (
                          <i key={`${g.name}-${i}`}>
                            {g.name.slice(0, 1).toUpperCase()}
                          </i>
                        ))}
                        {use.guests.length > 2 && (
                          <em>+{use.guests.length - 2}</em>
                        )}
                      </span>
                    ) : use.people > 0 ? (
                      <span className="friend-count">
                        {use.people} 位朋友
                      </span>
                    ) : null)}
                  {!outsideTrip && !departure && use.pending > 0 && (
                    <span className="pending-dot">◷ {use.pending}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <aside className="day-panel">
          <p className="panel-kicker">今晚住宿</p>
          <h3>{pretty(focus)}</h3>
          {isTripDeparture(focus) ? (
            <div className="trip-boundary-panel">
              <strong>此次旅行退房日</strong>
              <span>这一天不占床位，可作为所选住宿的退房日期。</span>
            </div>
          ) : !inTripNight(focus) ? (
            <div className="trip-boundary-panel">
              <strong>不在此次行程内</strong>
              <span>只有旅行开始日至退房日前一晚可以住宿。</span>
            </div>
          ) : night.blocked ? (
            <div className="blocked-panel">
              <strong>这晚不可住</strong>
              <span>{night.blocked}</span>
            </div>
          ) : (
            <>
              <div className="occupancy">
                <strong>
                  {night.exclusive
                    ? "🔒"
                    : `${night.approved}/${stay.total_capacity}`}
                </strong>
                <span>
                  {night.exclusive
                    ? "独占住宿 · 不接待其他住客"
                    : `已确认 · 余 ${remaining}`}
                </span>
              </div>
              {unlocked ? (
                <div className="guest-list">
                  {night.guests.length ? (
                    night.guests.map((g, i) => (
                      <div key={`${g.name}-${i}`}>
                        <i>{g.name.slice(0, 1).toUpperCase()}</i>
                        <span>
                          <b>{g.name}</b>
                          <small>
                            {g.size} 人{night.exclusive ? " · 独占" : ""}
                          </small>
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>这晚还没人住。</p>
                  )}
                </div>
              ) : (
                <form action={unlockGroup} className="unlock">
                  <p>
                    {night.people
                      ? `${night.people} 位朋友会来。输入 key code 查看昵称并申请。`
                      : "输入全群或个人 key code 查看昵称并申请。"}
                  </p>
                  <div>
                    <input
                      name="key"
                      type="password"
                      placeholder="Key code"
                      required
                    />
                    <button>解锁</button>
                  </div>
                </form>
              )}
              {night.pending > 0 && (
                <p className="pending-note">◷ 另有 {night.pending} 人待确认</p>
              )}
            </>
          )}
        </aside>
      </div>
      {unlocked && (
        <form action={submitRequest} className="quick-form">
          <input type="hidden" name="stay_id" value={stay.id} />
          <input type="hidden" name="starts_on" value={start} />
          <input type="hidden" name="ends_on" value={end} />
          <div className="selection">
            <span>
              {start && end
                ? `${pretty(start)}入住 → ${pretty(end)}退房`
                : "在日历上依次点击入住日和退房日"}
            </span>
            {start && end && (
              <b>
                {Math.round((Date.parse(end) - Date.parse(start)) / DAY)} 晚
              </b>
            )}
          </div>
          {error && (
            <p className="alert">
              {error === "rate"
                ? "尝试次数太多，请稍后再试。"
                : "请检查日期和填写内容。"}
            </p>
          )}
          <div className="quick-fields">
            <label>
              群里昵称 <small>会向群友显示</small>
              <input name="guest_name" required maxLength={80} defaultValue={guestName} />
            </label>
            <label>
              人数
              <input
                name="party_size"
                type="number"
                min="1"
                max="8"
                defaultValue="1"
                required
              />
            </label>
            {!isTrip&&stay.sofa_capacity>0&&<label className="check">
              <input name="accepts_sofa" type="checkbox" /> 可以睡 sofa
            </label>}
            {!isTrip&&stay.hidden_capacity>0&&
            <label className="check">
              <input name="accepts_air_mattress" type="checkbox" checked={acceptsAirMattress} onChange={event=>setAcceptsAirMattress(event.target.checked)} /> 接受隐藏备用位
            </label>}
            <label className="check exclusive-request">
              <input name="exclusive" type="checkbox" />
              <span>
                希望独占住宿
                <small>整段时间不与其他住客同住，最终由 {hostDisplayName} 确认</small>
              </span>
            </label>
          </div>
          <button className="primary" disabled={!start || !end}>
            提交给 {hostDisplayName} 确认
          </button>
        </form>
      )}
    </div>
  );
}
