import type { Metadata } from "next";
import "./globals.css";
import { serverI18n } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/provider";
import { CreationAccess } from "@/components/studio/creation-access";

const metadata: Metadata = {
  title: {
    default: "Plotloom · 短剧与小说创作平台",
    template: "%s · Plotloom",
  },
  description: "Plotloom 短剧与小说创作平台，从灵感、世界设定到故事正文，让创作逐步成形。",
  robots: { index: false, follow: false },
};

export async function generateMetadata(): Promise<Metadata> {
  const { ui } = await serverI18n();
  return { ...metadata, title: { default: ui("Plotloom · 短剧与小说创作平台"), template: "%s · Plotloom" }, description: ui(metadata.description) };
}
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { preferences } = await serverI18n();
  return <html lang={preferences.locale} dir={preferences.locale === "ar" ? "rtl" : "ltr"} data-market={preferences.market} data-output-locale={preferences.output_locale || preferences.locale}><body><LocaleProvider preferences={preferences}><CreationAccess />{children}</LocaleProvider></body></html>;
}
