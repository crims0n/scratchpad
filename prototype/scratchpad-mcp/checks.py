#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Reproduces the feasibility measurements reported on issue #19.

Usage:
    cargo build --release
    python3 checks.py [path/to/scratchpad-mcp]

Creates throwaway SQLite workspaces in a temporary directory, drives the server
over STDIO with raw JSON-RPC, and prints one line per check.
"""
import json
import os
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "target/release/scratchpad-mcp")

CURRENT_SCHEMA = """
CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
 updatedAt INTEGER NOT NULL, isTitleLocked INTEGER NOT NULL, isPinned INTEGER NOT NULL DEFAULT 0,
 folderId TEXT, sortOrder INTEGER NOT NULL DEFAULT 0);
CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, sortOrder INTEGER NOT NULL DEFAULT 0);
"""
# Pre-folders/pin/sortOrder shape that ensure_workspace_schema() migrates in the app.
LEGACY_SCHEMA = """
CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
 updatedAt INTEGER NOT NULL, isTitleLocked INTEGER NOT NULL);
"""


def call(db, *requests, timeout=60):
    """Run one server process through initialize + the given requests."""
    msgs = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2026-07-28", "capabilities": {},
                    "clientInfo": {"name": "checks", "version": "0"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
    ]
    msgs.extend(requests)
    started = time.time()
    proc = subprocess.run([BIN, "--workspace", db],
                          input="".join(json.dumps(m) + "\n" for m in msgs),
                          capture_output=True, text=True, timeout=timeout)
    replies = {}
    for line in proc.stdout.splitlines():
        if line.strip():
            body = json.loads(line)
            replies[body.get("id")] = body
    return proc, replies, time.time() - started


def tool(name, **arguments):
    return {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": name, "arguments": arguments}}


def notes_of(reply):
    if "result" not in reply:
        return None
    return json.loads(reply["result"]["content"][0]["text"])["notes"]


def report(label, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {label:52} {detail}")


def seed(path, schema, rows, folders=()):
    conn = sqlite3.connect(path)
    conn.executescript(schema)
    for folder in folders:
        conn.execute("INSERT INTO folders VALUES (?,?,?)", folder)
    columns = len(conn.execute("PRAGMA table_info(notes)").fetchall())
    for order, (note_id, title, content) in enumerate(rows):
        if columns == 5:  # legacy shape, before the app added ordering columns
            conn.execute("INSERT INTO notes VALUES (?,?,?,?,0)",
                         (note_id, title, content, 1700000000 + order))
        else:
            conn.execute("INSERT INTO notes VALUES (?,?,?,?,0,0,NULL,?)",
                         (note_id, title, content, 1700000000 + order, order))
    conn.commit()
    conn.close()


def main():
    if not os.path.exists(BIN):
        sys.exit(f"server binary not found at {BIN}; run `cargo build --release` first")
    work = tempfile.mkdtemp(prefix="scratchpad-mcp-checks-")
    print(f"binary:    {BIN}")
    print(f"workspace: {work}\n")

    current = os.path.join(work, "current.sqlite")
    seed(current, CURRENT_SCHEMA,
         [("n1", "Release checklist", "# Release\nbump version\n100% done_ready"),
          ("n2", "Grocery list", "milk\neggs\nbread"),
          ("n3", "Meeting notes", "Discussed the MCP server design and SQLite locking.")],
         folders=[("work", "Work", 0)])

    # --- handshake, tool surface, annotations -------------------------------
    proc, replies, _ = call(current, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    tools = replies[2]["result"]["tools"]
    report("handshake completes", 1 in replies)
    report("stdout carries only JSON-RPC",
           all(json.loads(l) for l in proc.stdout.splitlines() if l.strip()))
    report("read-only annotations on every tool",
           all(t["annotations"]["readOnlyHint"] and not t["annotations"]["destructiveHint"]
               for t in tools),
           ", ".join(t["name"] for t in tools))

    # --- schema tolerance ---------------------------------------------------
    legacy = os.path.join(work, "legacy.sqlite")
    seed(legacy, LEGACY_SCHEMA, [("old", "Legacy note", "written before folders existed")])
    _, replies, _ = call(legacy, tool("list_notes"))
    report("reads pre-migration schema read-only", len(notes_of(replies[3]) or []) == 1)

    empty = os.path.join(work, "empty.sqlite")
    seed(empty, CURRENT_SCHEMA, [])
    _, replies, _ = call(empty, tool("list_notes"))
    report("empty workspace returns an empty page", notes_of(replies[3]) == [])

    # --- search -------------------------------------------------------------
    unicode_db = os.path.join(work, "unicode.sqlite")
    seed(unicode_db, CURRENT_SCHEMA,
         [("u1", "Über uns", "German umlaut"), ("u2", "CAFÉ notes", "accented")])
    _, replies, _ = call(unicode_db, tool("search_notes", query="über"))
    report("search case-folds beyond ASCII (matches the app)",
           [n["title"] for n in notes_of(replies[3]) or []] == ["Über uns"])
    _, replies, _ = call(current, tool("search_notes", query="100%"))
    report("LIKE metacharacters are treated literally",
           [n["title"] for n in notes_of(replies[3]) or []] == ["Release checklist"])
    _, replies, _ = call(current, tool("search_notes", query="  "))
    report("blank query is rejected", "error" in replies[3], replies[3].get("error", {}).get("message", ""))

    # --- immutability -------------------------------------------------------
    before = open(current, "rb").read()
    call(current, tool("get_note", id="n1"))
    sidecars = [f for f in os.listdir(work) if f.startswith("current.sqlite-")]
    report("rollback-journal workspace is left byte-identical",
           open(current, "rb").read() == before and not sidecars,
           f"sidecars={sidecars}")

    # --- WAL ----------------------------------------------------------------
    wal = os.path.join(work, "wal.sqlite")
    seed(wal, CURRENT_SCHEMA, [("w1", "WAL note", "body")])
    conn = sqlite3.connect(wal)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("UPDATE notes SET title=title")
    conn.commit()
    conn.close()
    for suffix in ("-wal", "-shm"):
        if os.path.exists(wal + suffix):
            os.remove(wal + suffix)
    call(wal, tool("list_notes"))
    created = [s for s in ("-wal", "-shm") if os.path.exists(wal + s)]
    report("WAL workspace: reading creates sidecar files", bool(created),
           f"created={created}  <- immutability holds only for rollback-journal mode")

    rodir = os.path.join(work, "rodir")
    os.mkdir(rodir)
    ro_wal = os.path.join(rodir, "ws.sqlite")
    seed(ro_wal, CURRENT_SCHEMA, [("w1", "WAL note", "body")])
    conn = sqlite3.connect(ro_wal)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("UPDATE notes SET title=title")
    conn.commit()
    conn.close()
    for suffix in ("-wal", "-shm"):
        if os.path.exists(ro_wal + suffix):
            os.remove(ro_wal + suffix)
    os.chmod(rodir, 0o555)
    proc, _, _ = call(ro_wal, tool("list_notes"))
    report("WAL workspace in a read-only directory fails", proc.returncode != 0,
           proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "")
    os.chmod(rodir, 0o755)

    # --- concurrency --------------------------------------------------------
    result = {}

    def reader():
        _, replies, elapsed = call(current, tool("list_notes"))
        result["notes"] = notes_of(replies.get(3, {}))
        result["elapsed"] = elapsed

    writer = sqlite3.connect(current, isolation_level=None)
    writer.execute("BEGIN IMMEDIATE")
    writer.execute("DELETE FROM notes WHERE id='n2'")
    thread = threading.Thread(target=reader)
    thread.start()
    thread.join()
    writer.execute("ROLLBACK")
    writer.close()
    report("reads coexist with a held RESERVED lock",
           result["notes"] is not None and len(result["notes"]) == 3,
           f"{result['elapsed']:.2f}s, uncommitted DELETE not visible")

    writer = sqlite3.connect(current, isolation_level=None)
    writer.execute("BEGIN EXCLUSIVE")
    thread = threading.Thread(target=reader)
    thread.start()
    time.sleep(2)
    writer.execute("ROLLBACK")
    thread.join()
    writer.close()
    report("EXCLUSIVE lock shorter than the busy timeout is absorbed",
           result["notes"] is not None, f"{result['elapsed']:.2f}s")

    holder = {}

    def start_locked_read():
        proc, replies, _ = call(current, tool("list_notes"))
        holder["proc"] = proc
        holder["replies"] = replies

    writer = sqlite3.connect(current, isolation_level=None)
    writer.execute("BEGIN EXCLUSIVE")
    thread = threading.Thread(target=start_locked_read)
    thread.start()
    time.sleep(8)
    writer.execute("ROLLBACK")
    thread.join()
    writer.close()
    report("EXCLUSIVE lock past the busy timeout kills startup",
           holder["proc"].returncode != 0 and not holder["replies"],
           "no handshake, no error response -> validate lazily, after initialize")

    # --- hot journal --------------------------------------------------------
    hot = os.path.join(work, "hot.sqlite")
    seed(hot, CURRENT_SCHEMA, [("h1", "Survivor", "committed before the crash")])
    child = subprocess.Popen(
        [sys.executable, "-c",
         f"import sqlite3,time\n"
         f"c=sqlite3.connect({hot!r}, isolation_level=None)\n"
         f"c.execute('BEGIN IMMEDIATE')\n"
         f"c.execute('DELETE FROM notes')\n"
         f"print('ready',flush=True)\n"
         f"time.sleep(60)\n"],
        stdout=subprocess.PIPE, text=True)
    child.stdout.readline()
    os.kill(child.pid, signal.SIGKILL)
    child.wait()
    had_journal = os.path.exists(hot + "-journal")
    _, replies, _ = call(hot, tool("list_notes"))
    report("hot journal recovers in memory, journal untouched",
           had_journal and len(notes_of(replies[3]) or []) == 1 and os.path.exists(hot + "-journal"))

    # --- bad inputs ---------------------------------------------------------
    missing = subprocess.run([BIN, "--workspace", os.path.join(work, "nope.sqlite")],
                             capture_output=True, text=True, input="")
    junk = os.path.join(work, "junk.sqlite")
    open(junk, "w").write("not a database")
    not_db = subprocess.run([BIN, "--workspace", junk], capture_output=True, text=True, input="")
    no_arg = subprocess.run([BIN], capture_output=True, text=True, input="")
    report("bad inputs fail on stderr before any protocol traffic",
           all(p.returncode != 0 and not p.stdout.strip() for p in (missing, not_db, no_arg)))

    print(f"\nleft fixtures in {work}")


if __name__ == "__main__":
    main()
