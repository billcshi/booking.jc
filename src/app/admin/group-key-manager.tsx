"use client";
import {
  createInviteKey,
  resetGroupKey,
  resetInviteKey,
  toggleInviteKey,
} from "@/app/actions";
import type { InviteKey } from "@/lib/db";
import AdminPanel from "./admin-panel";
import { useI18n } from "../locale-provider";

export default function GroupKeyManager({
  groupKey,
  inviteKeys,
  reset,
  inviteCreated,
  inviteReset,
}: {
  groupKey: string;
  inviteKeys: InviteKey[];
  reset?: boolean;
  inviteCreated?: boolean;
  inviteReset?: boolean;
}) {
  const { locale, t } = useI18n();
  return (
    <AdminPanel eyebrow="ACCESS" title={t("Key code 管理")} description={t("维护全群 Key 和绑定昵称的个人邀请 Key。")} count={`${inviteKeys.filter((key) => key.active).length} ${t("个个人 Key")}`} className="access-panel">
      <div className="key-manager">
      <div className="key-heading">
        <div>
          <p>{t("全群共用一个 Key，也可以为特定客人生成独立 Key。")}</p>
        </div>
        <div className="key-value">
          <span>{t("全群 Key")}</span>
          <form action={resetGroupKey}>
            <input name="code" defaultValue={groupKey} required minLength={4} maxLength={64} pattern="[A-Za-z0-9._-]+" aria-label={locale==="en"?"Custom group key":"自定义全群 Key"} />
            <button>{t("保存自定义 Key")}</button>
          </form>
        </div>
      </div>
      {reset && (
        <p className="success">
          {t("全群 Key 已更新，旧 Key 和旧 session 均已失效。")}
        </p>
      )}
      {inviteCreated && <p className="success">{t("个人 Key 已创建。")}</p>}
      {inviteReset && (
        <p className="success">{t("个人 Key 已更新，旧 code 已失效。")}</p>
      )}
      <form action={createInviteKey} className="invite-create">
        <label>
          {t("客人姓名 / 群昵称")}
          <input
            name="guest_name"
            required
            maxLength={80}
            placeholder={t("姓名 / 群昵称")}
          />
        </label>
        <label>
          {t("自定义个人 Key")}<input name="code" required minLength={4} maxLength={64} pattern="[A-Za-z0-9._-]+" placeholder={locale==="en"?"e.g. guest-key":"例如 guest-key"} />
        </label>
        <button className="primary">{t("创建个人 Key")}</button>
      </form>
      <div className="invite-list">
        {inviteKeys.length === 0 ? (
          <p className="muted">{t("还没有个人 Key。")}</p>
        ) : (
          inviteKeys.map((key) => (
            <article className={key.active ? "" : "inactive"} key={key.id}>
              <div>
                <b>{key.guest_name}</b>
                <code>{key.code}</code>
                <small>
                  {key.active ? t("可用") : t("已停用")} · {t("使用")} {key.use_count} {t("次")}
                  {key.last_used_at
                    ? ` · ${t("最近")} ${key.last_used_at} UTC` : ` · ${t("尚未使用")}`}
                </small>
              </div>
              <div className="invite-actions">
                <form action={resetInviteKey}>
                  <input type="hidden" name="id" value={key.id} />
                  <input name="code" defaultValue={key.code} required minLength={4} maxLength={64} pattern="[A-Za-z0-9._-]+" aria-label={locale==="en"?`Edit ${key.guest_name}'s key`:`修改 ${key.guest_name} 的 Key`}/>
                  <button>{t("保存 code")}</button>
                </form>
                <form action={toggleInviteKey}>
                  <input type="hidden" name="id" value={key.id} />
                  <button>{key.active ? t("停用") : t("启用")}</button>
                </form>
              </div>
            </article>
          ))
        )}
      </div>
      </div>
    </AdminPanel>
  );
}
