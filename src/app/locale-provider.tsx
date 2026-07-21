"use client";
import { createContext, useContext } from "react";
import type { Locale, MessageKey } from "@/lib/i18n";
import { translate } from "@/lib/i18n";
const LocaleContext = createContext<Locale>("zh-CN");
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) { return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>; }
export function useI18n() { const locale = useContext(LocaleContext); return { locale, t: (key: MessageKey) => translate(locale, key) }; }
