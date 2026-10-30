"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, BookOpen, Check, Copy, Download, Globe2, ImagePlus, LogOut, Mail, Pencil, RefreshCw, UserRound } from "lucide-react";
import { Header } from "@/components/sites/storyplay/shared";
import { backendRequest as api, ensureStudioSpace, jsonBody, updateStudioUser, type StudioSpace, type StudioStatus, type StudioUser } from "@/lib/studio/api";
import { StudioNav } from "./navigation";
import { disableGoogleAutoSelect, LoginForm } from "./account-menu";
import { MembershipPanel } from "./membership-panel";
import styles from "./space.module.css";

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={error ? styles.error : styles.notice} role={error ? "alert" : "status"}>{children}</p>;
}

export function AccountPage() {
  const [space, setSpace] = useState<StudioSpace>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void ensureStudioSpace().then(value => { if (active) { setSpace(value); setError(""); } }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [retry]);
  return <div className="workspace-page"><Header workspace /><div className="plotloom-shell"><StudioNav selected="我的空间" />
    <main className={`plotloom-main ${styles.main}`}>
      <div className={styles.heading}><div><h1>我的空间</h1><p>管理个人资料与创作空间。</p></div><span className={styles.headingMark}>创作空间 / 账号设置</span></div>
      {space ? <AccountSettings key={space.space_id} space={space} onUserChanged={async user => { setSpace(await updateStudioUser(user)); }} /> : error ? <div className={styles.panel}><Notice error>{error}</Notice><button className={styles.secondary} onClick={() => { setError(""); setRetry(value => value + 1); }}><RefreshCw size={14} />重新读取</button></div> : <div className={styles.skeleton} role="status" aria-label="正在读取个人空间"><div /><div /><div /><span>正在读取个人空间…</span></div>}
    </main>
  </div></div>;
}

export function AccountSettings({ space, onUserChanged }: { space: StudioSpace; onUserChanged: (user: StudioUser) => Promise<void> }) {
  const user = space.user;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [feedbackAt, setFeedbackAt] = useState("");
  const [copied, setCopied] = useState(false);
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function run(key: string, action: () => Promise<void>, success: string) {
    if (lock.current) return false;
    lock.current = true; setBusy(key); setFeedbackAt(key); setError(""); setNotice("");
    try { await action(); setNotice(success); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); return false; }
    finally { lock.current = false; setBusy(""); }
  }
  async function saveUser(key: string, init: RequestInit, success: string) {
    return run(key, async () => {
      const result = await api<{ user: StudioUser }>(`/studio/auth/profile${key === "name" ? "" : "/avatar"}`, init);
      await onUserChanged(result.user);
    }, success);
  }
  function clearFile() { setFile(undefined); setPreview(""); if (fileInput.current) fileInput.current.value = ""; }
  function feedback(...keys: string[]) {
    if (!keys.includes(feedbackAt)) return null;
    return error ? <Notice error>{error}</Notice> : notice ? <Notice>{notice}</Notice> : null;
  }
  const avatar = preview || user?.avatar_url;
  return <>
    <section className={`${styles.profile} ${styles.panel}`} aria-labelledby="profile-heading">
      <div className={styles.avatar}>
        {/* Private authenticated and local preview URLs must bypass image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {avatar ? <img key={avatar} src={avatar} alt="个人头像" onError={event => { event.currentTarget.hidden = true; }} /> : null}
        <span aria-hidden="true">{user ? Array.from(user.name.trim())[0]?.toLocaleUpperCase() : <UserRound size={34} strokeWidth={1.3} />}</span>
      </div>
      <div className={styles.identity}><div className={styles.identityLine}><span className={styles.eyebrow}>个人资料</span><span className={styles.status}><i />{user ? "已登录" : "访客空间"}</span></div>
        <h2 id="profile-heading">{user?.name || "从这里，开始你的故事"}</h2>
        <p>{user ? <><Mail size={14} />{user.email}</> : "登录后，在不同设备上继续创作。"}</p>
        {user && <div className={styles.profileActions}>
          <label className={styles.fileButton} aria-disabled={!!busy}><ImagePlus size={14} />更换头像<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={!!busy} aria-label="选择头像图片" onChange={event => {
            const selected = event.target.files?.[0];
            if (!selected) return;
            setFeedbackAt("avatar"); setError(""); setNotice("");
            if (selected.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(selected.type)) { clearFile(); setError("请选择 2 MiB 以内的 JPG、PNG 或 WebP 图片。"); return; }
            setFile(selected);
          }} /></label>
          {file ? <><button className={styles.primary} disabled={!!busy} onClick={async () => { if (await saveUser("avatar", { method: "PUT", headers: { "Content-Type": file.type }, body: file }, "头像已保存")) clearFile(); }}>{busy === "avatar" ? "上传中…" : "保存头像"}</button><button className={styles.textButton} disabled={!!busy} onClick={clearFile}>取消</button></> : user.avatar_url && <button className={styles.textButton} disabled={!!busy} onClick={() => void saveUser("remove-avatar", { method: "DELETE" }, "已恢复默认头像")}>{busy === "remove-avatar" ? "恢复中…" : "恢复默认头像"}</button>}
        </div>}
        {user && <small>JPG、PNG、WebP · 最大 2 MiB · 自动居中裁剪</small>}
      </div>
    </section>
    {feedback("avatar", "remove-avatar")}
    <div className={styles.columns}>
      <div className={styles.primaryColumn}>
        <section id={user ? undefined : "account-login"} className={styles.panel} aria-labelledby="account-heading"><div className={styles.sectionHeading}><h2 id="account-heading">{user ? "账号资料" : "登录账号"}</h2><span>{user ? "管理你的个人身份" : "邮箱或 Google 均可登录"}</span></div>
          {user ? <>
            <div className={styles.settingRow}><div><h3>昵称</h3><p>在 Plotloom 中显示的名字</p></div>{!editing && <button className={styles.textButton} disabled={!!busy} onClick={() => { setName(user.name); setEditing(true); }}><span className={styles.currentName}>{user.name}</span><Pencil size={14} /><span className={styles.srOnly}>编辑昵称</span></button>}</div>
            {editing && <form className={styles.nameForm} onSubmit={async event => { event.preventDefault(); if (await saveUser("name", { method: "PATCH", body: jsonBody({ name: name.trim() }) }, "昵称已保存")) setEditing(false); }}><label htmlFor="profile-name" className={styles.srOnly}>昵称</label><input id="profile-name" value={name} maxLength={80} required disabled={!!busy} onChange={event => setName(event.target.value)} /><div><button className={styles.primary} disabled={!!busy || !name.trim()}>{busy === "name" ? "保存中…" : "保存昵称"}</button><button type="button" className={styles.textButton} disabled={!!busy} onClick={() => setEditing(false)}>取消</button></div></form>}
            <div className={styles.settingRow}><div><h3>邮箱地址</h3><p>用于账号识别与验证码登录</p></div><span className={styles.rowValue}>{user.email}</span></div>
            {feedback("name")}
          </> : <LoginForm />}
        </section>
        <section className={styles.panel} aria-labelledby="space-heading"><div className={styles.sectionHeading}><h2 id="space-heading">账号与空间</h2><span>让每个故事各有所属</span></div>
          <div className={styles.settingRow}><div><h3>空间编号</h3><p>此编号用于区分创作空间</p></div><button className={styles.copyButton} onClick={() => void run("copy", async () => { await navigator.clipboard.writeText(space.space_id); setCopied(true); }, "空间编号已复制")} disabled={!!busy} aria-label="复制空间编号"><code>{space.space_id}</code>{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>
          <div className={styles.ownership}><span className={styles.ownershipIcon}><UserRound size={18} /></span><div><h3>{user ? "作品已归属于当前账号" : "当前为浏览器独立空间"}</h3><p>{user ? "作品、世界和生成任务仅此账号可见，在其他浏览器登录同一账号即可继续访问。" : "作品和世界保存在此浏览器空间。更换浏览器或清理网站数据前，请先下载备份。"}</p></div></div>
          {user && <div className={styles.logout}><p>退出不会删除账号中的作品。</p><button className={styles.textButton} disabled={!!busy} onClick={() => void run("logout", async () => { await api("/studio/auth/logout", { method: "POST", body: "{}" }); disableGoogleAutoSelect(); window.location.reload(); }, "")}><LogOut size={14} />{busy === "logout" ? "正在退出…" : "退出登录"}</button></div>}
          {feedback("copy", "logout")}
        </section>
        <section className={styles.panel} aria-labelledby="data-heading"><div className={styles.sectionHeading}><h2 id="data-heading">数据与备份</h2><span>给创作留一份底稿</span></div>
          <Link className={styles.linkRow} href="/workspace"><span className={styles.linkIcon}><Download size={18} /></span><div><h3>作品备份与导入</h3><p>在作品库导出完整备份，或导入已有作品</p></div><ArrowUpRight size={16} /></Link>
          <Link className={styles.linkRow} href="/worlds"><span className={styles.linkIcon}><Globe2 size={18} /></span><div><h3>世界库管理</h3><p>管理、导入与导出你的世界设定</p></div><ArrowUpRight size={16} /></Link>
          <details className={styles.recovery}><summary>恢复以前的共享作品</summary><p>使用维护者提供的一次性恢复码，将原共享作品与世界转入当前空间。原稿会完整保留。</p><form onSubmit={async event => {
            event.preventDefault();
            if (!code.trim()) return;
            if (await run("recovery", async () => { await api("/studio/session/claim-legacy", { method: "POST", body: jsonBody({ code: code.trim() }) }); }, "原有作品已恢复到本空间，可前往作品库查看。")) setCode("");
          }}><label htmlFor="legacy-recovery-code">一次性恢复码</label><input id="legacy-recovery-code" type="password" autoComplete="off" minLength={20} maxLength={128} required value={code} disabled={!!busy} onChange={event => setCode(event.target.value)} /><button className={styles.secondary} disabled={!!busy || !code.trim()}>{busy === "recovery" ? "正在恢复…" : "恢复到当前空间"}</button></form></details>
          {feedback("recovery")}
        </section>
      </div>
      <aside className={styles.secondaryColumn} aria-label="会员与创作服务"><MembershipPanel /><CreativeService /><Link className={styles.helpLink} href="/tutorial"><BookOpen size={17} /><span>创作教程与使用说明</span><ArrowUpRight size={15} /></Link></aside>
    </div>
  </>;
}

export function CreativeService() {
  const [status, setStatus] = useState<StudioStatus>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<StudioStatus>("/studio/status", { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setStatus(value); setError(""); } }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [retry]);
  return <section className={`${styles.panel} ${styles.service}`} aria-labelledby="service-heading"><div className={styles.sectionHeading}><h2 id="service-heading">创作服务</h2><span>由平台统一维护</span></div>
    {status ? <><dl><div><dt>当前模型</dt><dd>{status.model || "未配置"}</dd></div><div><dt>服务配置</dt><dd className={styles.serviceState}>{status.llm_ready ? "已配置" : "尚未配置"}</dd></div><div><dt>同时执行上限</dt><dd>{status.max_concurrent_requests !== undefined ? `${status.max_concurrent_requests} 个请求` : "暂不可用"}</dd></div><div><dt>全站排队上限</dt><dd>{status.max_queued_requests !== undefined ? `${status.max_queued_requests} 个任务` : "暂不可用"}</dd></div><div><dt>每空间排队上限</dt><dd>{status.max_queued_per_space !== undefined ? `${status.max_queued_per_space} 个任务` : "暂不可用"}</dd></div></dl><p>多人等待时轮流调度，同一作品的章节按顺序衔接。</p>{!!status.dispatch_retry_after_seconds && <Notice>生成请求暂缓启动，排队内容已保留。</Notice>}</> : error ? <><Notice error>模型信息读取失败：{error}</Notice><button className={styles.textButton} onClick={() => { setError(""); setRetry(value => value + 1); }}>重新读取</button></> : <p role="status">正在读取服务信息…</p>}
  </section>;
}
