"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUI } from "@/lib/i18n/provider";
import { backendRequest, ensureStudioSpace, hasKnownStudioAccount, type StudioSpace } from "@/lib/studio/api";
import { creationDestination, loginRequiredEvent } from "@/lib/studio/creation-access";
import { LoginDialog } from "./account-menu";
import { useRouter } from "next/navigation";
import { Header, Modal } from "@/components/sites/storyplay/shared";
import Link from "next/link";
import { StudioNav } from "./navigation";

import { EditorSkeleton } from "./generation-feedback";

async function verifiedSession() {
  // Share the initial cookie bootstrap with the header and all other panels.
  await ensureStudioSpace();
  return backendRequest<StudioSpace>("/studio/session");
}

export function CreationAccess() {
  const ui = useUI();
  const router = useRouter();
  const [destination, setDestination] = useState<string>();
  const [membershipRequired, setMembershipRequired] = useState(false);
  const authenticated = useRef(false);
  useEffect(() => {
    let disposed = false;
    const refresh = () => { void verifiedSession().then(space => { if (!disposed) authenticated.current = !!space.user; }).catch(() => { authenticated.current = false; }); };
    const requestLogin = (event: Event) => {
      authenticated.current = false;
      const href = (event as CustomEvent<string>).detail || window.location.href;
      setDestination(creationDestination(href, window.location.origin) || "/workspace");
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || authenticated.current || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      const href = link && creationDestination(link.href, window.location.origin);
      if (!href) return;
      event.preventDefault(); event.stopPropagation();
      void verifiedSession().then(space => {
        if (disposed) return;
        authenticated.current = !!space.user;
        if (space.user) window.location.assign(href);
        else if (document.getElementById("account-login")) window.location.assign(href);
        else setDestination(href);
      }).catch(() => { if (!disposed) setDestination(href); });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(loginRequiredEvent, requestLogin);
    const requestMembership = () => setMembershipRequired(true);
    window.addEventListener("plotloom-membership-required", requestMembership);
    document.addEventListener("click", click, true);
    return () => { disposed = true; window.removeEventListener("focus", refresh); window.removeEventListener(loginRequiredEvent, requestLogin); window.removeEventListener("plotloom-membership-required", requestMembership); document.removeEventListener("click", click, true); };
  }, []);
  if (destination) return <LoginDialog onSuccess={() => window.location.assign(destination)} onClose={() => {
    setDestination(undefined);
    if (creationDestination(window.location.href, window.location.origin)) router.replace("/workspace");
  }} />;
  return membershipRequired ? <Modal title={ui("需要会员")} onClose={() => setMembershipRequired(false)}><p>{ui("此操作需要有效会员，请购买会员。")}</p><p>{ui("月卡与年卡价格及购买方式即将公布。")}</p><Link className="pill light" href="/account#membership-heading" onClick={() => setMembershipRequired(false)}>{ui("查看会员")}</Link></Modal> : null;
}

export function CreationGuard({ children }: { children: ReactNode }) {
  const ui = useUI();
  const [allowed, setAllowed] = useState(hasKnownStudioAccount);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    void verifiedSession().then(space => {
      if (disposed) return;
      setAllowed(!!space.user); setChecked(true);
      if (!space.user) window.dispatchEvent(new CustomEvent(loginRequiredEvent, { detail: window.location.href }));
    }).catch(() => { if (!disposed) { setError(true); setChecked(true); } });
    return () => { disposed = true; };
  }, []);
  if (allowed) return children;
  return <div className="workspace-page"><Header workspace /><div className="plotloom-shell"><StudioNav /><main className="studio-main" aria-busy={!checked}>
    {!checked ? <EditorSkeleton /> : <p role="status">{ui(error ? "无法建立独立创作空间，请检查连接并刷新；请求不会自动重试。" : "请先登录后使用小说或剧本创作。")}</p>}
    {checked && <button type="button" className="pill" onClick={() => window.dispatchEvent(new CustomEvent(loginRequiredEvent, { detail: window.location.href }))}>{ui("登录")}</button>}
  </main></div></div>;
}
