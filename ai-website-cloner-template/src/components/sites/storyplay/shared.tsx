"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";

export function Logo() {
  return <Link href="/" className="brand" aria-label="Plotloom 首页"><span className="brand-wordmark">Plotloom</span></Link>;
}

export function Header({ workspace = false }: { workspace?: boolean }) {
  return <header className="site-header"><div className="header-inner"><Logo />
    <span className="preview-badge">本地前端预览</span>
    <nav aria-label="主导航">
      {workspace ? <Link href="/" className="text-link"><ArrowLeft size={14} /> 返回首页</Link> : <>
        <Link href="/corpus" className="text-link">语料参考</Link>
        <a className="text-link tutorial-link" href="https://oi4bb2mpywg.feishu.cn/wiki/Q8ubwcxrEicmtNkyNvVcDNHLnFh" target="_blank" rel="noreferrer">使用教程 <ArrowUpRight size={12} /></a>
      </>}
      <Link className="pill light" href="/workspace">{workspace ? "我的作品" : "创作工作台"}</Link>
    </nav>
  </div></header>;
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? "modal-wide" : ""}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></div>
    {children}
  </dialog>;
}

export function SectionHeading({ children, tone = "gold" }: { children: ReactNode; tone?: string }) {
  return <div className={`section-heading ${tone}`}><h2>{children}</h2><svg aria-hidden="true" viewBox="0 0 166 25"><path d="M5 10Q60 1 161 4L20 14L140 13L54 22" /></svg></div>;
}
