"use client";
import { useEffect, useState } from "react";
import { useUI, usePreferences } from "@/lib/i18n/provider";
import { backendRequest } from "@/lib/studio/api";
import { Gem } from "lucide-react";
import styles from "./space.module.css";

type Membership = { active: boolean; plan: "trial" | "monthly" | "yearly" | null; expires_at: number | null; last_expired_at: number | null };

export function MembershipPanel({ signedIn }: { signedIn: boolean }) {
  const ui = useUI();
  const { locale } = usePreferences();
  const [membership, setMembership] = useState<Membership>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void backendRequest<Membership>("/studio/membership").then(value => { if (live) setMembership(value); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [signedIn]);
  const plan = membership?.plan === "trial" ? "新用户体验会员" : membership?.plan === "monthly" ? "月卡会员" : membership?.plan === "yearly" ? "年卡会员" : "未开通";
  const time = membership?.expires_at ?? membership?.last_expired_at;
  const expiry = time ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(time * 1000)) : "—";
  return <section className={styles.membership} aria-labelledby="membership-heading">
    <div className={styles.membershipTop}><Gem size={24} strokeWidth={1.4} /><span>{ui(!signedIn ? "登录后查看" : error ? "读取失败" : !membership ? "正在读取…" : membership.active ? "会员有效" : "会员未生效")}</span></div>
    <h2 id="membership-heading">{ui("Plotloom 会员")}</h2>
    <p>{ui("会员可使用全部创作功能，新用户注册赠送 1 天会员。")}</p>
    <dl className={styles.memberFacts}><div><dt>{ui("会员等级")}</dt><dd>{ui(membership ? plan : "—")}</dd></div><div><dt>{ui("有效期")}</dt><dd>{expiry}</dd></div></dl>
    <div className={styles.memberActions}><span>{ui("月卡")}</span><span>{ui("年卡")}</span></div>
    <span className={styles.memberFootnote}>{ui("月卡与年卡价格及购买方式即将公布。")}</span>
  </section>;
}
