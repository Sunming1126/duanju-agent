import { Gem, ArrowUpRight } from "lucide-react";
import styles from "./space.module.css";

// Replace the unavailable state with actual entitlements when billing is connected.
export type MembershipSummary = { status: "coming_soon" };

export function MembershipPanel({ summary = { status: "coming_soon" } }: { summary?: MembershipSummary }) {
  return <section className={styles.membership} aria-labelledby="membership-heading" data-status={summary.status}>
    <div className={styles.membershipTop}><Gem size={24} strokeWidth={1.4} /><span>即将开放</span></div>
    <h2 id="membership-heading">会员与积分</h2>
    <p>为你的下一段创作，留出更多可能。</p>
    <dl className={styles.memberFacts}><div><dt>会员等级</dt><dd>—</dd></div><div><dt>有效期</dt><dd>—</dd></div><div><dt>积分余额</dt><dd>—</dd></div></dl>
    <div className={styles.memberActions}><button disabled>会员权益 <ArrowUpRight size={14} /></button><button disabled>积分明细 <ArrowUpRight size={14} /></button></div>
    <span className={styles.memberFootnote}>会员及积分服务暂未开放</span>
  </section>;
}
