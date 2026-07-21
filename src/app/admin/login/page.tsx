import Link from "next/link";
import { login } from "@/app/actions";
import { getI18n } from "@/lib/i18n-server";

export default async function Login({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const {error}=await searchParams,{t}=await getI18n();
  return <main className="center"><form action={login} className="login-card"><Link href="/" className="brand">booking.jc</Link><h1>{t("Host login")}</h1>{error&&<p className="alert">{error==="rate"?t("尝试次数太多，请 15 分钟后再试。"):t("Credentials 不正确。")}</p>}<label>{t("Username")}<input name="username" autoComplete="username" required/></label><label>{t("Password")}<input name="password" type="password" autoComplete="current-password" required/></label><button className="primary">{t("Log in")}</button></form></main>;
}
