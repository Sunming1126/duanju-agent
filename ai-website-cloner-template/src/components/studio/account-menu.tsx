"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { LogIn, Mail } from "lucide-react";
import { Modal } from "@/components/sites/storyplay/shared";
import { backendRequest as api, ensureStudioSpace, jsonBody, type StudioSpace } from "@/lib/studio/api";
import styles from "./account.module.css";

type AuthConfig = { email_enabled: boolean; google_client_id: string };
type GoogleId = {
  initialize: (options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; auto_select: boolean }) => void;
  renderButton: (element: HTMLElement, options: { type: string; theme: string; size: string; text: string; width: number }) => void;
  disableAutoSelect: () => void;
};
function googleId() { return (window as Window & { google?: { accounts: { id: GoogleId } } }).google?.accounts.id; }

export function AccountMenu() {
  const [space, setSpace] = useState<StudioSpace>();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void ensureStudioSpace().then(setSpace).catch(() => setFailed(true)); }, []);
  if (space?.user || (!space && !failed)) return null;
  return <>
    <button className={`pill light ${styles.trigger}`} onClick={() => {
      const inline = document.getElementById("account-login");
      if (inline) { inline.scrollIntoView({ block: "start" }); inline.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }); }
      else setOpen(true);
    }} aria-label="登录">
      <LogIn size={15} /><span>登录</span>
    </button>
    {open && <LoginDialog onClose={() => setOpen(false)} />}
  </>;
}

export function LoginDialog({ onClose }: { onClose: () => void }) {
  const lock = useRef(false);
  return <Modal title="登录 Plotloom" onClose={() => { if (!lock.current) onClose(); }}><LoginForm onBusyChange={value => { lock.current = value; }} /></Modal>;
}

export function disableGoogleAutoSelect() { googleId()?.disableAutoSelect(); }

export function LoginForm({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [config, setConfig] = useState<AuthConfig>();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "login" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const lock = useRef(false);
  const googleButton = useRef<HTMLDivElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => { onBusyChange?.(!!busy); }, [busy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    void api<AuthConfig>("/studio/auth/config").then(value => { if (mounted.current) setConfig(value); }).catch(cause => { if (mounted.current) setError(cause.message); });
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);
  useEffect(() => {
    if (!config?.google_client_id || !googleReady || !googleButton.current) return;
    let disposed = false;
    void api<{ nonce: string }>("/studio/auth/google/nonce", { method: "POST", body: "{}" }).then(({ nonce }) => {
      if (disposed || !googleButton.current) return;
      const google = googleId();
      if (!google) return;
      google.initialize({ client_id: config.google_client_id, nonce, auto_select: false, callback: ({ credential }) => {
        if (!mounted.current || lock.current) return;
        lock.current = true; setBusy("login"); setError("");
        void api("/studio/auth/google", { method: "POST", body: jsonBody({ credential }) }).then(() => window.location.reload()).catch(cause => {
          if (mounted.current) { setError(cause.message); setBusy(null); }
          lock.current = false;
        });
      } });
      google.renderButton(googleButton.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", width: Math.max(200, Math.min(280, googleButton.current.clientWidth)) });
    }).catch(cause => { if (!disposed) setGoogleError(cause.message); });
    return () => { disposed = true; };
  }, [config, googleReady]);

  async function sendCode() {
    if (lock.current || remaining || !emailInput.current?.reportValidity()) return;
    lock.current = true; setBusy("send"); setError(""); setNotice("");
    try {
      const result = await api<{ retry_after: number }>("/studio/auth/email-code/send", { method: "POST", body: jsonBody({ email: email.trim() }) });
      setRemaining(result.retry_after); setNotice("验证码已发送，10 分钟内有效，请检查收件箱或垃圾邮件。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发送失败，请稍后重试"); }
    finally { lock.current = false; setBusy(null); }
  }
  return <div className={styles.loginForm}>
    <div className={styles.intro}><span><Mail size={19} /></span><p>登录后，在不同设备上继续你的故事。</p></div>
    <form className={styles.form} onSubmit={async event => {
      event.preventDefault(); if (lock.current) return;
      lock.current = true; setBusy("login"); setError("");
      try { await api("/studio/auth/email-code/login", { method: "POST", body: jsonBody({ email: email.trim(), code }) }); window.location.reload(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "登录失败，请重试"); lock.current = false; setBusy(null); }
    }}>
      <label htmlFor="login-email">邮箱地址</label>
      <input ref={emailInput} id="login-email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required value={email} disabled={!!busy} onChange={event => { setEmail(event.target.value); setCode(""); setNotice(""); }} />
      <label htmlFor="login-code">验证码</label>
      <div className={styles.codeRow}><input id="login-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6 位验证码" required value={code} disabled={!!busy} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        <button type="button" className="outline-button" disabled={!config?.email_enabled || !!busy || remaining > 0 || !email.trim()} onClick={() => void sendCode()}>{busy === "send" ? "发送中…" : remaining ? `${remaining} 秒后重发` : "获取验证码"}</button></div>
      <button type="submit" className={`pill ${styles.submit}`} disabled={!config?.email_enabled || !!busy || code.length !== 6}>{busy === "login" ? "正在登录…" : "邮箱验证码登录"}</button>
    </form>
    {config && !config.email_enabled && <p className={styles.hint}>邮箱登录尚未配置，请联系维护者。</p>}
    {notice && <p className={styles.hint} role="status">{notice}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.divider}><span>或</span></div>
    {config?.google_client_id ? <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setGoogleReady(true)} onError={() => setGoogleError("Google 登录加载失败，请检查网络或使用邮箱登录。")} />
      <div ref={googleButton} className={styles.google} aria-label="Google 登录" inert={!!busy || undefined} />
      {!googleReady && !googleError && <p className={styles.hint}>正在加载 Google 登录…</p>}
    </> : <button className={`outline-button ${styles.full}`} disabled>使用 Google 登录{config ? "（暂未配置）" : "（加载中）"}</button>}
    {googleError && <p className={styles.error} role="alert">{googleError}</p>}
    <p className={styles.footnote}>首次登录将自动创建账号，并关联当前浏览器空间的作品。已有账号登录后进入其原有空间，访客作品不会自动合并；请先导出备份。</p>
  </div>;
}
