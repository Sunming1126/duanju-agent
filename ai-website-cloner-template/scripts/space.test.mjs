import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(name, dependencies = {}) {
  const source = readFileSync(new URL(`../src/lib/studio/${name}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(exports,require){${code}\n})`)(exports, name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  });
  return exports;
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("concurrent page requests share one session bootstrap before accessing private records", async () => {
  const api = load("api");
  const original = globalThis.fetch;
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    globalThis.fetch = async (path, init) => {
      calls.push({ path, init });
      if (path.endsWith("/session")) { await gate; return json({ space_id: "private-a", isolated: true, legacy_access: false }); }
      return json({ items: [] });
    };
    const pending = Promise.all(["works", "worlds", "status", "references"].map(path => api.backendRequest(`/studio/${path}`)));
    assert.equal(calls.length, 1);
    release(); await pending;
    assert.equal(calls.filter(call => call.path.endsWith("/session")).length, 1);
    assert.equal(calls.length, 5);
    assert.equal(api.currentSpaceId(), "private-a");
    assert.ok(calls.every(call => call.init.credentials === "same-origin" && call.init.cache === "no-store"));
  } finally { globalThis.fetch = original; }
});

test("failed session setup never sends a manuscript mutation or automatically retries", async () => {
  const api = load("api");
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async path => { calls.push(path); throw new Error("offline"); };
    await assert.rejects(api.backendRequest("/studio/works", { method: "POST", body: "{}" }), /不会自动重试/);
    assert.deepEqual(calls, ["/api/backend/studio/session"]);
    assert.equal(api.currentSpaceId(), undefined);
  } finally { globalThis.fetch = original; }
});

test("expired identity does not retry a mutation and hides the previous workspace snapshot", async () => {
  const api = load("api");
  const library = load("library", { "./api": api });
  const original = globalThis.fetch;
  const calls = [];
  let space = "private-a";
  try {
    globalThis.fetch = async path => {
      calls.push(path);
      return path.endsWith("/session") ? json({ space_id: space, isolated: true }) : json({ detail: "空间已失效" }, 401);
    };
    await api.ensureStudioSpace();
    library.rememberLibrary([{ id: "old-private-work" }]);
    assert.equal(library.librarySnapshot()[0].id, "old-private-work");
    await assert.rejects(api.backendRequest("/studio/works", { method: "POST", body: "{}" }), /空间已失效/);
    assert.equal(calls.length, 2);
    assert.equal(library.librarySnapshot(), undefined);
    space = "private-b";
    await api.ensureStudioSpace();
    assert.equal(library.librarySnapshot(), undefined);
  } finally { globalThis.fetch = original; }
});

test("mutations carry the original space so a stale tab cannot write into a different account", async () => {
  const api = load("api");
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (path, init) => {
      calls.push({ path, init });
      return path.endsWith("/session") ? json({ space_id: "account-a", isolated: true }) : json({ detail: "账号已切换，请刷新" }, 409);
    };
    await assert.rejects(api.backendRequest("/studio/works", { method: "POST", body: "{}" }), /账号已切换/);
    assert.equal(calls[1].init.headers["X-Plotloom-Space"], "account-a");
    assert.equal(calls.length, 2);
    assert.equal(api.currentSpaceId(), "account-a");
  } finally { globalThis.fetch = original; }
});

test("profile updates refresh the shared user snapshot without switching spaces or draft ownership", async () => {
  const api = load("api");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => json({ space_id: "account-a", isolated: true, user: { id: "a", name: "旧笔名" } });
    await api.ensureStudioSpace();
    const draft = api.scopedDraftKey("novel");
    const updated = { id: "a", name: "新笔名", email: "author@example.com", avatar_url: "/api/backend/studio/auth/profile/avatar?v=new" };
    await api.updateStudioUser(updated);
    assert.deepEqual((await api.ensureStudioSpace()).user, updated);
    assert.equal(api.currentSpaceId(), "account-a");
    assert.equal(api.scopedDraftKey("novel"), draft);
    await assert.rejects(api.updateStudioUser({ ...updated, id: "b" }), /账号已切换/);
    assert.equal((await api.ensureStudioSpace()).user.id, "a");
  } finally { globalThis.fetch = original; }
});

test("drafts are scoped to one space and legacy recovery cannot leak into a new guest or account", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const values = new Map([["plotloom-new-novel", "private legacy draft"]]);
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  async function space(id, user) {
    const api = load("api");
    globalThis.fetch = async () => json({ space_id: id, isolated: true, user });
    await api.ensureStudioSpace();
    return api;
  }
  try {
    const guest = await space("guest-a", null);
    assert.equal(guest.readScopedDraft("plotloom-new-novel"), "private legacy draft");
    const other = await space("guest-b", null);
    assert.equal(other.readScopedDraft("plotloom-new-novel"), null);
    assert.notEqual(other.scopedDraftKey("plotloom-new-novel"), guest.scopedDraftKey("plotloom-new-novel"));
    const account = await space("account-b", { id: "b" });
    assert.equal(account.readScopedDraft("plotloom-new-novel"), null);
    const claimed = await space("guest-a", { id: "a" });
    assert.equal(claimed.readScopedDraft("plotloom-new-novel"), "private legacy draft");
    values.delete(guest.scopedDraftKey("plotloom-new-novel"));
    assert.equal(guest.readScopedDraft("plotloom-new-novel"), null);
    assert.equal(values.get("plotloom-new-novel"), "private legacy draft");
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});
