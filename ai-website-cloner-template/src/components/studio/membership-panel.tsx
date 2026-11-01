"use client";
import { useUI } from "@/lib/i18n/provider";

import { Gem, ArrowUpRight } from "lucide-react";
import styles from "./space.module.css";

// Replace the unavailable state with actual entitlements when billing is connected.
export type MembershipSummary = { status: "coming_soon" };

export function MembershipPanel({ summary = { status: "coming_soon" } }: { summary?: MembershipSummary }) {
  const ui = useUI();
  return <section className={styles.membership} aria-labelledby="membership-heading" data-status={summary.status}>
    <div className={styles.membershipTop}><Gem size={24} strokeWidth={1.4} /><span>{ui("即将开放")}</span></div>
    <h2 id="membership-heading">{ui("会员与积分")}</h2>
    <p>{ui("为你的下一段创作，留出更多可能。")}</p>
    <dl className={styles.memberFacts}><div><dt>{ui("会员等级")}</dt><dd>{ui("—")}</dd></div><div><dt>{ui("有效期")}</dt><dd>{ui("—")}</dd></div><div><dt>{ui("积分余额")}</dt><dd>{ui("—")}</dd></div></dl>
    <div className={styles.memberActions}><button disabled>{ui("会员权益 ")}<ArrowUpRight size={14} /></button><button disabled>{ui("积分明细 ")}<ArrowUpRight size={14} /></button></div>
    <span className={styles.memberFootnote}>{ui("会员及积分服务暂未开放")}</span>
  </section>;
}
