"""Cross-platform task sync. Run with Python 3; requires Git on PATH."""

import argparse
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent


def git(*args, capture=False):
    result = subprocess.run(
        ["git", *args], cwd=ROOT, check=True,
        stdout=subprocess.PIPE if capture else None,
        encoding="utf-8", errors="replace",
    )
    return result.stdout.strip() if capture else ""


def clean():
    if git("status", "--porcelain", "--untracked-files=all", capture=True):
        raise RuntimeError("Working tree is not clean. Preserve and review existing changes first.")


def sync(action, message):
    git("rev-parse", "--show-toplevel", capture=True)
    for marker in ("MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD"):
        path = Path(git("rev-parse", "--git-path", marker, capture=True))
        if not path.is_absolute():
            path = ROOT / path
        if path.exists():
            raise RuntimeError("An unfinished Git operation exists. Resolve it before syncing.")
    branch = git("symbolic-ref", "--quiet", "--short", "HEAD", capture=True)
    remote = git("remote", "get-url", "origin", capture=True)
    if remote not in (
        "git@github.com:Sunming1126/duanju-agent.git",
        "https://github.com/Sunming1126/duanju-agent.git",
        "ssh://git@ssh.github.com:443/Sunming1126/duanju-agent.git",
    ):
        raise RuntimeError("Origin does not match the agreed project repository.")
    if action == "start":
        clean()
        git("pull", "--ff-only", "origin", branch)
        print("Ready: remote changes pulled. Re-read AGENT.md if updated.")
        return

    # Never stage files implicitly. Review/stage this task's files before finish.
    if git("diff", "--name-only", capture=True) or git("ls-files", "--others", "--exclude-standard", capture=True):
        raise RuntimeError("Unstaged or untracked files exist. Review and explicitly stage task files first.")
    if git("diff", "--cached", "--name-only", capture=True):
        git("commit", "-m", message)
    clean()
    git("fetch", "origin")
    # A newly created task branch has no remote counterpart yet.
    refs = git("for-each-ref", "--format=%(refname)", "refs/remotes/origin/", capture=True).splitlines()
    if f"refs/remotes/origin/{branch}" in refs:
        git("-c", "rebase.autoStash=false", "pull", "--rebase", "origin", branch)
    git("push", "--set-upstream", "origin", branch)
    local = git("rev-parse", "HEAD", capture=True)
    remote_head = git("ls-remote", "--heads", "origin", f"refs/heads/{branch}", capture=True).split()
    if not remote_head or remote_head[0] != local:
        raise RuntimeError("Remote branch differs from local HEAD. Inspect concurrent updates and retry.")
    clean()
    print(f"Synced: {branch} {local[:12]} matches GitHub.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "finish"))
    parser.add_argument("-m", "--message", help="Commit message for staged task changes")
    args = parser.parse_args()
    if args.action == "finish" and not args.message:
        parser.error("finish requires -m / --message")
    try:
        sync(args.action, args.message)
    except (subprocess.CalledProcessError, OSError, RuntimeError) as exc:
        print(f"Sync stopped: {exc}\nLocal changes/commits are preserved. Check git status; resolve the issue and retry.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
