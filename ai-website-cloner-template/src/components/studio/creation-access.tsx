"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUI } from "@/lib/i18n/provider";
import { backendRequest, ensureStudioSpace, type StudioSpace } from "@/lib/studio/api";
import { creationDestination, loginRequiredEvent } from "@/lib/studio/creation-access";
import { LoginDialog } from "./account-menu";
import { useRouter } from "next/navigation";

async function verifiedSession() {
  // Share the initial cookie bootstrap with the header and all other panels.
  await ensureStudioSpace();
  return backendRequest<StudioSpace>("/studio/session");
}

export function CreationAccess() {
  const router = useRouter();
  const [destination, setDestination] = useState<string>();
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
    document.addEventListener("click", click, true);
    return () => { disposed = true; window.removeEventListener("focus", refresh); window.removeEventListener(loginRequiredEvent, requestLogin); document.removeEventListener("click", click, true); };
  }, []);
  return destination ? <LoginDialog onSuccess={() => window.location.assign(destination)} onClose={() => {
    setDestination(undefined);
    if (creationDestination(window.location.href, window.location.origin)) router.replace("/workspace");
  }} /> : null;
}

export function CreationGuard({ children }: { children: ReactNode }) {
  const ui = useUI();
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    void verifiedSession().then(space => {
      if (disposed) return;
      if (space.user) setAllowed(true);
      else window.dispatchEvent(new CustomEvent(loginRequiredEvent, { detail: window.location.href }));
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, []);
  if (allowed) return children;
  return <div className="workspace-page"><p role="status">{ui(error ? "无法建立独立创作空间，请检查连接并刷新；请求不会自动重试。" : "请先登录后使用小说或剧本创作。")}</p><button type="button" className="pill" onClick={() => window.dispatchEvent(new CustomEvent(loginRequiredEvent, { detail: window.location.href }))}>{ui("登录")}</button></div>;
}
