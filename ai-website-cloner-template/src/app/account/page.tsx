import { serverI18n } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AccountPage } from "@/components/studio/account-page";

const pageMetadata: Metadata = { title: "我的空间", description: "管理 Plotloom 个人资料、账号与创作空间。" };

export default function Page() { return <AccountPage />; }

export async function generateMetadata() { const { ui } = await serverI18n(); return { ...pageMetadata, title: ui(pageMetadata.title), description: ui(pageMetadata.description) }; }
