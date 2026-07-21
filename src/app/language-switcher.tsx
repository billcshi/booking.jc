"use client";
import { useI18n } from "./locale-provider";
export default function LanguageSwitcher() {
  const { locale } = useI18n(), next = locale === "en" ? "zh-CN" : "en";
  return <button type="button" className="language-switcher" onClick={() => { document.cookie = `booking_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`; window.location.reload(); }} aria-label={locale === "en" ? "切换到中文" : "Switch to English"}>{locale === "en" ? "中文" : "EN"}</button>;
}
