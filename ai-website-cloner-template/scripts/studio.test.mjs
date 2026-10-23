import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(name, dependencies = {}) {
  const source = readFileSync(
    new URL(`../src/lib/studio/${name}.ts`, import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(exports, require){${compiled}\n})`)(
    exports,
    (name) => {
      if (!(name in dependencies))
        throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  );
  return exports;
}
const legacy = load("legacy");
const codec = load("world-codec");
const api = load("api");

test("explicit browser draft migration preserves original raw text and stable ids", () => {
  const raw = JSON.stringify([
    {
      id: "old-1",
      title: "旧稿",
      genre: "悬疑",
      premise: "想法",
      characters: "人物",
      outline: "大纲",
      body: "原正文",
      episodes: "12",
      mode: "新建剧本",
    },
  ]);
  const result = legacy.legacyWorks(raw);
  assert.equal(result[0].chapters[0].content, "原正文");
  assert.equal(result[0].legacy_id, "browser-v1:old-1");
  assert.equal(result[0].market, "china");
  assert.equal(JSON.parse(raw)[0].body, "原正文");
  assert.deepEqual(legacy.legacyWorks(null), []);
  assert.throws(() => legacy.legacyWorks("{bad"));
  assert.throws(() => legacy.legacyWorks("[{}]"));
});

test("world package browser checksum matches Python canonical JSON for all supported fields", async () => {
  const sections = JSON.parse(
    readFileSync(
      new URL(
        "../../third_party/storyforge/world-sections.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const world = {
    name: "雾海🌊",
    description: "第一行\n第二行",
    sections: Object.fromEntries(
      sections
        .flatMap((s) => s.fields)
        .map((f) => [f.key, `${f.label}：“中文”`]),
    ),
  };
  const payload = { schema: "onesay.world-draft", version: 1, world };
  const expected = spawnSync(
    process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"),
    [
      "-c",
      'import sys,json,hashlib; print(hashlib.sha256(json.dumps(json.load(sys.stdin),ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest())',
    ],
    { input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
  );
  assert.equal(expected.status, 0);
  assert.equal(await codec.worldDraftChecksum(payload), expected.stdout.trim());
});

test("requests send China header and never retry failed mutations", async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (path, init) => {
      calls.push({ path, init });
      return new Response(JSON.stringify({ detail: "版本已变化" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    };
    await assert.rejects(
      api.backendRequest("/studio/works", { method: "POST", body: "{}" }),
      /版本已变化/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/api/backend/studio/works");
    assert.equal(calls[0].init.headers["X-Duanju-Site"], "china");
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    await assert.rejects(api.backendRequest("/studio/status"), /不会自动重试/);
  } finally {
    globalThis.fetch = original;
  }
});

test("export includes unsaved manuscript and save payload excludes server metadata", () => {
  const work = {
    id: "server-id",
    revision: 2,
    created_at: 1,
    updated_at: 2,
    title: "未保存标题",
    content_type: "novel",
    units: 2,
    premise: "当前设定",
    characters: "人物",
    outline: "大纲",
    chapters: [{ number: 1, title: "开端", content: "尚未保存的正文" }],
  };
  assert.match(api.localExport(work), /尚未保存的正文/);
  assert.match(api.localExport(work), /第1章/);
  assert.equal("id" in api.workPayload(work), false);
  assert.equal("revision" in api.workPayload(work), false);
});

const generation = load("generation", { "./api": api });

test("generate saves edited draft first and uses returned revision exactly once", async () => {
  const original = globalThis.fetch;
  const calls = [];
  let saved;
  const work = {
    id: "draft",
    revision: 3,
    premise: "新故事想法",
    title: "故事",
  };
  try {
    globalThis.fetch = async (path, init) => {
      calls.push({ path, init });
      const response =
        init.method === "PUT"
          ? { ...work, revision: 4 }
          : { id: "candidate", status: "running" };
      return new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      });
    };
    const result = await generation.generateWorkCandidate(work, {
      action: "chapter",
      number: 2,
      dirty: true,
      onSaved: (value) => {
        saved = value;
      },
    });
    assert.equal(saved.revision, 4);
    assert.deepEqual(
      calls.map((c) => c.init.method),
      ["PUT", "POST"],
    );
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      action: "chapter",
      number: 2,
      revision: 4,
    });
    assert.equal(result.id, "candidate");
    calls.length = 0;
    await generation.generateWorkCandidate(work, {
      action: "premise",
      number: 1,
      dirty: false,
      onSaved: () => assert.fail("clean draft must not be saved again"),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
  } finally {
    globalThis.fetch = original;
  }
});

test("save conflict blocks generation and missing story never sends a request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ detail: "作品已更新" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    };
    const options = {
      action: "premise",
      number: 1,
      dirty: true,
      onSaved: () => assert.fail("failed save must not replace local text"),
    };
    await assert.rejects(
      generation.generateWorkCandidate(
        { id: "draft", revision: 1, premise: "想法" },
        options,
      ),
      /作品已更新/,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      generation.generateWorkCandidate(
        { id: "draft", revision: 1, premise: " " },
        options,
      ),
      /请先填写故事想法/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
