"""Prepare a one-time recovery code for the pre-isolation shared workspace.

Run on the server as its service user. Only a hash enters SQLite. The code stays
in a mode-0600 file under data/studio; transfer it privately to the site owner.
"""
import argparse
import os
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agent.studio_store import StudioStore
from agent.studio_identity import SpaceStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=ROOT / "data/studio/studio.sqlite3")
    args = parser.parse_args()
    target = args.db.resolve().parent / "legacy-claim-code.txt"
    if target.exists():
        raise SystemExit("Recovery-code file already exists; preserve it and inspect the current claim state.")
    code = secrets.token_urlsafe(32)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            file.write(code + "\n")
        SpaceStore(StudioStore(args.db)).prepare_legacy_claim(code)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    print(f"One-time code prepared at {target}; no manuscripts changed. Do not commit or publish this file.")


if __name__ == "__main__":
    main()
