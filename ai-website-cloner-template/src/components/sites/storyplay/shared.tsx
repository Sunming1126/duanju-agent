"use client";
import { useUI } from "@/lib/i18n/provider";


import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, type ReactNode } from "react";
import { LanguageSwitcher } from "@/components/studio/language-settings";
import { ArrowLeft, X } from "lucide-react";

const AccountMenu = dynamic(() => import("@/components/studio/account-menu").then(module => module.AccountMenu), { ssr: false });

export function Logo() {
  const ui = useUI();
  return <Link href="/" className="brand" aria-label={ui("Plotloom 首页")}><span className="brand-wordmark">{ui("Plotloom")}</span></Link>;
}

export function Header({ workspace = false }: { workspace?: boolean }) {
  const ui = useUI();
  return <header className="site-header"><div className="header-inner"><Logo />
    <span className="preview-badge">{ui("中文创作空间")}</span>
    <nav aria-label={ui("主导航")}>
      {workspace ? <Link href="/" className="pill light"><ArrowLeft size={14} /> {ui(" 返回首页")}</Link> : <>
        <Link href="/samples" className="text-link header-samples-link">{ui("官方样例")}</Link>
        <Link href="/tutorial" className="text-link">{ui("教程说明")}</Link>
        <Link className="pill light" href="/workspace">{ui("创作工作台")}</Link>
      </>}
      <LanguageSwitcher /><AccountMenu />
    </nav>
  </div></header>;
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ui = useUI();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? "modal-wide" : ""}`} aria-label={ui(title)} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label={ui("关闭")}><X size={20} /></button></div>
    {ui(children)}
  </dialog>;
}

export function SectionHeading({ children, tone = "gold" }: { children: ReactNode; tone?: string }) {
  const ui = useUI();
  return <div className={`section-heading ${tone}`}><h2>{ui(children)}</h2><svg aria-hidden="true" viewBox="0 0 166 25"><path d="M5 10Q60 1 161 4L20 14L140 13L54 22" /></svg></div>;
}
