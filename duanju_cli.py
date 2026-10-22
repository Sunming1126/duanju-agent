# -*- coding: utf-8 -*-
"""duanju MCP 一键调用器 —— 把 mcp_server.py（stdio MCP）包装成命令行直调

用法：
  python duanju_cli.py list_tools                        # 列出全部工具
  python duanju_cli.py server_status --pretty            # 诊断
  python duanju_cli.py search_materials --query "逆袭 打脸" --top_k 3
  python duanju_cli.py check_script --script "@剧本.txt"  # @开头=从文件读长文本
  python duanju_cli.py generate_script --idea "豪门弃妇..." --hero 沈曼 --timeout 300

原理：每次调用拉起 mcp_server.py 子进程，完成 MCP stdio JSON-RPC
握手（initialize → tools/call），打印结果后退出。
任何 agent（Trae / Codex / WorkBuddy）通过终端即可调用全部短剧产能能力。
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _rpc(proc, obj):
    proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
    proc.stdin.flush()


def _recv(proc, want_id, timeout_s):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        line = proc.stdout.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        if msg.get("id") == want_id:
            return msg
    return None


def _handshake(proc):
    _rpc(proc, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2024-11-05", "capabilities": {},
        "clientInfo": {"name": "duanju-cli", "version": "1.0"}}})
    init = _recv(proc, 1, 30)
    if not init or "result" not in init:
        raise RuntimeError("MCP initialize 失败")
    _rpc(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"})


def call_tool(tool: str, args: dict, timeout_s: float = 300):
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "mcp_server.py")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, encoding="utf-8", bufsize=1,
        cwd=str(ROOT), env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
    )
    try:
        _handshake(proc)
        _rpc(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": {"name": tool, "arguments": args}})
        resp = _recv(proc, 2, timeout_s)
        if not resp:
            raise RuntimeError(f"tools/call 超时（{timeout_s}s）")
        if "error" in resp:
            raise RuntimeError(f"MCP error: {resp['error']}")
        texts = [c.get("text", "") for c in resp["result"].get("content", [])
                 if c.get("type") == "text"]
        out = "\n".join(texts)
        try:
            return json.loads(out)
        except Exception:
            return out
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


def list_tools(timeout_s: float = 60):
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "mcp_server.py")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, encoding="utf-8", bufsize=1,
        cwd=str(ROOT), env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
    )
    try:
        _handshake(proc)
        _rpc(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        resp = _recv(proc, 2, timeout_s)
        if not resp or "error" in resp:
            raise RuntimeError("tools/list 失败")
        return [{"name": t["name"], "description": (t.get("description") or "")[:80]}
                for t in resp["result"].get("tools", [])]
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


def _coerce(v: str):
    """参数值类型推断：int/float/JSON，其余原样字符串；@开头=读文件"""
    if v.startswith("@"):
        return Path(v[1:]).read_text(encoding="utf-8")
    for cast in (int, float):
        try:
            return cast(v)
        except ValueError:
            pass
    if v and v[0] in "[{":
        try:
            return json.loads(v)
        except Exception:
            pass
    return v


def main():
    ap = argparse.ArgumentParser(description="短剧 MCP 一键调用器")
    ap.add_argument("tool", help="工具名，list_tools 查看全部")
    ap.add_argument("--timeout", type=float, default=300, help="调用超时秒数（生成类建议 300）")
    ap.add_argument("--pretty", action="store_true", help="格式化输出")
    ns, unknown = ap.parse_known_args()

    args, i = {}, 0
    while i < len(unknown):
        k = unknown[i]
        if not k.startswith("--"):
            i += 1
            continue
        v = unknown[i + 1] if i + 1 < len(unknown) else ""
        args[k[2:]] = _coerce(v)
        i += 2

    try:
        out = list_tools(ns.timeout) if ns.tool == "list_tools" else call_tool(ns.tool, args, ns.timeout)
    except Exception as e:
        print(json.dumps({"error": str(e), "tool": ns.tool}, ensure_ascii=False))
        sys.exit(1)

    print(json.dumps(out, ensure_ascii=False, indent=2 if ns.pretty else None, default=str))


if __name__ == "__main__":
    main()
