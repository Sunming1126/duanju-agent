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
