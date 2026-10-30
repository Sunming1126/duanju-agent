import type { Metadata } from "next";
import { AccountPage } from "@/components/studio/account-page";

export const metadata: Metadata = { title: "我的空间", description: "管理 Plotloom 个人资料、账号与创作空间。" };

export default function Page() { return <AccountPage />; }
