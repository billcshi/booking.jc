import "server-only";
import { cookies } from "next/headers";
import { normalizeLocale, translate } from "@/lib/i18n";
export async function getI18n() {
  const locale = normalizeLocale((await cookies()).get("booking_locale")?.value);
  return { locale, t: (key: Parameters<typeof translate>[1]) => translate(locale, key) };
}
