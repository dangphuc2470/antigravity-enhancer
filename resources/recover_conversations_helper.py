#!/usr/bin/env python3
"""
Antigravity Enhancer - Conversation Auto-Recovery Helper
Used by the Antigravity Enhancer VS Code extension to:
  - Take periodic snapshots of trajectorySummaries
  - Detect missing/dropped conversations (e.g. after crash / sudden exit)
  - Incrementally sync missing conversations into state.vscdb
  - Full non-interactive rebuild and snapshot restoration
"""

import sys
import os
import sqlite3
import base64
import json
import re
import time
import platform
from urllib.parse import quote, unquote, urlparse

_SYSTEM = platform.system()
_ANTIGRAVITY_NAMES = ("Antigravity IDE", "antigravity", "Antigravity")

# ─── Path Discovery ──────────────────────────────────────────────────────────

def _existing_paths(*candidates):
    return [p for p in candidates if p and os.path.exists(p)]

def _first_existing(*candidates):
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return candidates[0] if candidates else None

if _SYSTEM == "Windows":
    _appdata = os.path.expandvars(r"%APPDATA%")
    _profile = os.path.expandvars(r"%USERPROFILE%")
    _gemini = os.path.join(_profile, ".gemini")

    _DB_CANDIDATES = (
        os.path.join(_appdata, "Antigravity IDE", "User", "globalStorage", "state.vscdb"),
        os.path.join(_appdata, "antigravity", "User", "globalStorage", "state.vscdb"),
        os.path.join(_appdata, "Antigravity", "User", "globalStorage", "state.vscdb"),
    )
    WORKSPACE_STORAGE_DIR = _first_existing(
        os.path.join(_appdata, "Antigravity IDE", "User", "workspaceStorage"),
        os.path.join(_appdata, "antigravity", "User", "workspaceStorage"),
    )
    _ALL_CONV_DIRS = [
        os.path.join(_gemini, "antigravity-ide", "conversations"),
        os.path.join(_gemini, "antigravity", "conversations"),
        os.path.join(_gemini, "antigravity-backup", "conversations"),
    ]
    _ALL_BRAIN_DIRS = [
        os.path.join(_gemini, "antigravity-ide", "brain"),
        os.path.join(_gemini, "antigravity", "brain"),
        os.path.join(_gemini, "antigravity-backup", "brain"),
    ]
elif _SYSTEM == "Darwin":
    _home = os.path.expanduser("~")
    _support = os.path.join(_home, "Library", "Application Support")
    _gemini = os.path.join(_home, ".gemini")

    _DB_CANDIDATES = (
        os.path.join(_support, "Antigravity IDE", "User", "globalStorage", "state.vscdb"),
        os.path.join(_support, "antigravity", "User", "globalStorage", "state.vscdb"),
    )
    WORKSPACE_STORAGE_DIR = _first_existing(
        os.path.join(_support, "Antigravity IDE", "User", "workspaceStorage"),
        os.path.join(_support, "antigravity", "User", "workspaceStorage"),
    )
    _ALL_CONV_DIRS = [
        os.path.join(_gemini, "antigravity-ide", "conversations"),
        os.path.join(_gemini, "antigravity", "conversations"),
        os.path.join(_gemini, "antigravity-backup", "conversations"),
    ]
    _ALL_BRAIN_DIRS = [
        os.path.join(_gemini, "antigravity-ide", "brain"),
        os.path.join(_gemini, "antigravity", "brain"),
        os.path.join(_gemini, "antigravity-backup", "brain"),
    ]
else:
    _home = os.path.expanduser("~")
    _config = os.path.join(_home, ".config")
    _gemini = os.path.join(_home, ".gemini")

    _DB_CANDIDATES = (
        os.path.join(_config, "Antigravity IDE", "User", "globalStorage", "state.vscdb"),
        os.path.join(_config, "Antigravity", "User", "globalStorage", "state.vscdb"),
    )
    WORKSPACE_STORAGE_DIR = _first_existing(
        os.path.join(_config, "Antigravity IDE", "User", "workspaceStorage"),
        os.path.join(_config, "Antigravity", "User", "workspaceStorage"),
    )
    _ALL_CONV_DIRS = [
        os.path.join(_gemini, "antigravity-ide", "conversations"),
        os.path.join(_gemini, "antigravity", "conversations"),
        os.path.join(_gemini, "antigravity-backup", "conversations"),
    ]
    _ALL_BRAIN_DIRS = [
        os.path.join(_gemini, "antigravity-ide", "brain"),
        os.path.join(_gemini, "antigravity", "brain"),
        os.path.join(_gemini, "antigravity-backup", "brain"),
    ]

DB_PATHS = _existing_paths(*_DB_CANDIDATES)

SNAPSHOT_FILE = os.path.join(_gemini, "antigravity_snapshot_trajectory_summaries.b64")
SNAPSHOT_INFO_FILE = os.path.join(_gemini, "antigravity_snapshot_info.json")

# ─── Protobuf Helpers ────────────────────────────────────────────────────────

def encode_varint(value):
    result = b""
    while value > 0x7F:
        result += bytes([(value & 0x7F) | 0x80])
        value >>= 7
    result += bytes([value & 0x7F])
    return result or b'\x00'

def decode_varint(data, pos):
    result, shift = 0, 0
    while pos < len(data):
        b = data[pos]
        result |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            return result, pos + 1
        shift += 7
        pos += 1
    return result, pos

def skip_protobuf_field(data, pos, wire_type):
    if wire_type == 0:
        _, pos = decode_varint(data, pos)
    elif wire_type == 2:
        length, pos = decode_varint(data, pos)
        pos += length
    elif wire_type == 1:
        pos += 8
    elif wire_type == 5:
        pos += 4
    return pos

def iter_length_delimited_fields(data, target_field_number):
    pos = 0
    try:
        while pos < len(data):
            tag, pos = decode_varint(data, pos)
            field_number, wire_type = tag >> 3, tag & 7
            if wire_type == 2:
                length, pos = decode_varint(data, pos)
                end = pos + length
                if end > len(data):
                    return
                if field_number == target_field_number:
                    yield data[pos:end]
                pos = end
            else:
                new_pos = skip_protobuf_field(data, pos, wire_type)
                if new_pos <= pos or new_pos > len(data):
                    return
                pos = new_pos
    except Exception:
        return

def encode_length_delimited(field_number, data):
    tag = (field_number << 3) | 2
    return encode_varint(tag) + encode_varint(len(data)) + data

def encode_string_field(field_number, string_value):
    return encode_length_delimited(field_number, string_value.encode('utf-8'))

def strip_field_from_protobuf(data, target_field_number):
    remaining = b""
    pos = 0
    while pos < len(data):
        start_pos = pos
        try:
            tag, pos = decode_varint(data, pos)
        except Exception:
            remaining += data[start_pos:]
            break
        wire_type = tag & 7
        field_num = tag >> 3
        new_pos = skip_protobuf_field(data, pos, wire_type)
        if new_pos == pos and wire_type not in (0, 1, 2, 5):
            remaining += data[start_pos:]
            break
        pos = new_pos
        if field_num != target_field_number:
            remaining += data[start_pos:pos]
    return remaining

# ─── Workspace and Timestamp Helpers ─────────────────────────────────────────

def _is_remote_uri(path_or_uri):
    return path_or_uri.startswith("vscode-remote://") or path_or_uri.startswith("file:///")

def path_to_workspace_uri(folder_path):
    if _is_remote_uri(folder_path):
        return folder_path
    p = folder_path.replace("\\", "/")
    if len(p) >= 2 and p[1] == ":":
        drive = p[0].lower()
        rest = p[2:]
        return f"file:///{drive}:{rest}"
    elif p.startswith("/"):
        return f"file://{p}"
    return f"file:///{p}"

def build_workspace_field(folder_path):
    uri = path_to_workspace_uri(folder_path)
    ws_sub = encode_string_field(1, uri)
    ws_sub += encode_varint((2 << 3) | 0) + encode_varint(1)
    return encode_length_delimited(9, ws_sub)

def build_timestamp_fields(epoch_seconds):
    seconds = int(epoch_seconds)
    ts_inner = encode_varint((1 << 3) | 0) + encode_varint(seconds)
    return (
        encode_length_delimited(3, ts_inner)
        + encode_length_delimited(7, ts_inner)
        + encode_length_delimited(10, ts_inner)
    )

def build_timestamp_field(field_number, epoch_seconds):
    ts_inner = encode_varint((1 << 3) | 0) + encode_varint(int(epoch_seconds))
    return encode_length_delimited(field_number, ts_inner)

def extract_timestamp_seconds(inner_blob, field_number=3):
    values = []
    for timestamp_blob in iter_length_delimited_fields(inner_blob or b"", field_number):
        pos = 0
        try:
            while pos < len(timestamp_blob):
                tag, pos = decode_varint(timestamp_blob, pos)
                nested_field, wire_type = tag >> 3, tag & 7
                if nested_field == 1 and wire_type == 0:
                    seconds, pos = decode_varint(timestamp_blob, pos)
                    values.append(seconds)
                    break
                new_pos = skip_protobuf_field(timestamp_blob, pos, wire_type)
                if new_pos <= pos or new_pos > len(timestamp_blob):
                    break
                pos = new_pos
        except Exception:
            continue
    return max(values) if values else None

def extract_workspace_hint(inner_blob):
    for f9_data in iter_length_delimited_fields(inner_blob or b"", 9):
        for uri_bytes in iter_length_delimited_fields(f9_data, 1):
            try:
                uri = uri_bytes.decode('utf-8', errors='replace')
                if uri:
                    return uri
            except Exception:
                pass
    return None

def build_trajectory_entry(conversation_id, title, existing_inner_data=None,
                           workspace_path=None, conversation_mtime=None,
                           source_is_db=False, exact_db_time=False):
    if existing_inner_data:
        preserved_fields = strip_field_from_protobuf(existing_inner_data, 1)
        inner_info = encode_string_field(1, title) + preserved_fields
        if workspace_path:
            inner_info = strip_field_from_protobuf(inner_info, 9)
            inner_info += build_workspace_field(workspace_path)
        if source_is_db and conversation_mtime:
            if exact_db_time:
                inner_info = strip_field_from_protobuf(inner_info, 3)
                inner_info += build_timestamp_field(3, conversation_mtime)
                inner_info = strip_field_from_protobuf(inner_info, 10)
                inner_info += build_timestamp_field(10, conversation_mtime)
            else:
                indexed_mtime = extract_timestamp_seconds(existing_inner_data, 3)
                if indexed_mtime is None or int(conversation_mtime) > indexed_mtime:
                    inner_info = strip_field_from_protobuf(inner_info, 3)
                    inner_info += build_timestamp_field(3, conversation_mtime)
    else:
        inner_info = encode_string_field(1, title)
        if workspace_path:
            inner_info += build_workspace_field(workspace_path)
        if conversation_mtime:
            inner_info += build_timestamp_fields(conversation_mtime)

    info_b64 = base64.b64encode(inner_info).decode('utf-8')
    sub_message = encode_string_field(1, info_b64)
    entry = encode_string_field(1, conversation_id)
    entry += encode_length_delimited(2, sub_message)
    return entry

# ─── SQLite Inspection Helpers ───────────────────────────────────────────────

def _open_sqlite_readonly(db_path):
    if not os.path.isfile(db_path):
        raise FileNotFoundError(db_path)
    absolute = os.path.abspath(db_path).replace("\\", "/")
    uri = "file:" + quote(absolute, safe="/:") + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    try:
        conn.execute("PRAGMA query_only=ON")
    except Exception:
        pass
    return conn

def _find_step_table(conn):
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    for (table_name,) in cursor.fetchall():
        quoted = '"' + table_name.replace('"', '""') + '"'
        columns = {row[1] for row in conn.execute("PRAGMA table_info(" + quoted + ")").fetchall()}
        if "step_type" in columns and ("step_payload" in columns or "metadata" in columns):
            return quoted, "idx" in columns
    return None, False

def normalize_prompt_text(prompt):
    if not isinstance(prompt, str):
        return ""
    return re.sub(r"\s+", " ", prompt).strip()

def format_prompt_title(prompt):
    normalized = normalize_prompt_text(prompt)
    if not normalized:
        return None
    normalized = re.sub(r"https?://[^\s<>()]+", lambda m: urlparse(m.group(0)).hostname or m.group(0), normalized)
    normalized = re.sub(r"^#{1,6}\s+", "", normalized)
    m = re.match(r"^(.+?[.!?])(?:\s|$)", normalized)
    if m and len(m.group(1).strip()) <= 60 and len(m.group(1).strip().split()) <= 10:
        return m.group(1).strip()
    words = normalized.split()[:10]
    res = " ".join(words)
    if len(res) > 60:
        res = res[:57].rstrip() + "…"
    elif len(normalized.split()) > 10:
        res += "…"
    return res or None

def extract_prompt_from_conversation_db(db_path):
    conn = None
    try:
        conn = _open_sqlite_readonly(db_path)
        table, has_idx = _find_step_table(conn)
        if not table:
            return None
        order = 'ORDER BY "idx" ASC' if has_idx else "ORDER BY rowid ASC"
        rows = conn.execute(f"SELECT step_payload FROM {table} WHERE step_type=14 {order}")
        for row in rows:
            if not row or not row[0]:
                continue
            payload = row[0]
            if isinstance(payload, memoryview):
                payload = payload.tobytes()
            for cont in iter_length_delimited_fields(payload, 19):
                for tbytes in iter_length_delimited_fields(cont, 2):
                    try:
                        p = tbytes.decode("utf-8")
                        p = normalize_prompt_text(p)
                        if p:
                            return p
                    except Exception:
                        pass
        return None
    except Exception:
        return None
    finally:
        if conn:
            conn.close()

def extract_conversation_db_timestamp(db_path):
    if not os.path.isfile(db_path):
        return None
    conn = None
    try:
        conn = _open_sqlite_readonly(db_path)
        table, has_idx = _find_step_table(conn)
        if not table:
            return None
        columns = {row[1] for row in conn.execute("PRAGMA table_info(" + table + ")").fetchall()}
        order = 'ORDER BY "idx" DESC' if has_idx else "ORDER BY rowid DESC"
        col = "metadata" if "metadata" in columns else "step_payload"
        cursor = conn.execute(f"SELECT {col} FROM {table} WHERE {col} IS NOT NULL {order} LIMIT 15")
        for row in cursor.fetchall():
            blob = row[0]
            if isinstance(blob, memoryview):
                blob = blob.tobytes()
            if not isinstance(blob, bytes) or not blob:
                continue
            for sub in iter_length_delimited_fields(blob, 1):
                pos = 0
                while pos < len(sub):
                    tag, pos = decode_varint(sub, pos)
                    fn, wt = tag >> 3, tag & 7
                    if fn == 1 and wt == 0:
                        sec, pos = decode_varint(sub, pos)
                        if 1500000000 < sec < 2500000000:
                            return sec
                    else:
                        pos = skip_protobuf_field(sub, pos, wt)
                        if pos <= 0:
                            break
        return None
    except Exception:
        return None
    finally:
        if conn:
            conn.close()

def get_conversation_effective_timestamp(conv_path):
    if not conv_path or not os.path.exists(conv_path):
        return None, False
    if conv_path.lower().endswith(".db"):
        ts = extract_conversation_db_timestamp(conv_path)
        if ts is not None and ts > 0:
            return ts, True
    try:
        return int(os.path.getmtime(conv_path)), False
    except OSError:
        return None, False

# ─── Brain & Workspace Inference ─────────────────────────────────────────────

def _iter_brain_paths(conversation_id):
    for bdir in _ALL_BRAIN_DIRS:
        p = os.path.join(bdir, conversation_id)
        if os.path.isdir(p):
            yield p

def get_title_from_brain(conversation_id):
    for brain_path in _iter_brain_paths(conversation_id):
        try:
            for item in sorted(os.listdir(brain_path)):
                if item.startswith('.') or not item.endswith('.md'):
                    continue
                fp = os.path.join(brain_path, item)
                with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                    for idx, line in enumerate(f):
                        if idx >= 100:
                            break
                        h = line.strip()
                        if h.startswith('#'):
                            return h.lstrip('# ').strip()[:80]
        except Exception:
            pass
    return None

def load_known_workspace_uris():
    uris = set()
    if not WORKSPACE_STORAGE_DIR or not os.path.isdir(WORKSPACE_STORAGE_DIR):
        return uris
    try:
        for entry in os.listdir(WORKSPACE_STORAGE_DIR):
            wf = os.path.join(WORKSPACE_STORAGE_DIR, entry, "workspace.json")
            if os.path.isfile(wf):
                try:
                    with open(wf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        folder = data.get("folder")
                        if folder:
                            uris.add(folder)
                except Exception:
                    pass
    except Exception:
        pass
    return sorted(uris, key=len, reverse=True)

def infer_workspace_from_brain(conversation_id, known_ws_uris=None):
    if known_ws_uris is None:
        known_ws_uris = load_known_workspace_uris()
    local_re = re.compile(r"file:///(?:[A-Za-z]:/[^)\s\"'`]+|[^)\s\"'`]+)")
    found = []
    for brain_path in _iter_brain_paths(conversation_id):
        try:
            for name in os.listdir(brain_path):
                if not name.endswith(".md"):
                    continue
                with open(os.path.join(brain_path, name), "r", encoding="utf-8", errors="replace") as f:
                    content = f.read(16384)
                    for m in local_re.finditer(content):
                        found.append(m.group(0))
        except Exception:
            pass
    if not found:
        return None
    if known_ws_uris:
        for furi in found:
            norm = furi.replace("%20", " ")
            for wuri in known_ws_uris:
                wnorm = wuri.replace("%20", " ")
                if norm.startswith(wnorm + "/") or norm == wnorm:
                    if wnorm.startswith("file:///"):
                        return wnorm[8:] if len(wnorm) > 9 and wnorm[9] == ':' else wnorm[7:]
                    return wuri
    return None

# ─── Metadata Extraction from state.vscdb ────────────────────────────────────

def extract_existing_metadata(db_path):
    titles = {}
    inner_blobs = {}
    try:
        conn = sqlite3.connect(db_path, timeout=5.0)
        cur = conn.cursor()
        cur.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.trajectorySummaries'")
        row = cur.fetchone()
        conn.close()
        if not row or not row[0]:
            return titles, inner_blobs
        decoded = base64.b64decode(row[0])
        pos = 0
        while pos < len(decoded):
            tag, pos = decode_varint(decoded, pos)
            if (tag & 7) != 2:
                break
            length, pos = decode_varint(decoded, pos)
            entry = decoded[pos:pos + length]
            pos += length

            ep, uid, info_b64 = 0, None, None
            while ep < len(entry):
                t, ep = decode_varint(entry, ep)
                fn, wt = t >> 3, t & 7
                if wt == 2:
                    l, ep = decode_varint(entry, ep)
                    content = entry[ep:ep + l]
                    ep += l
                    if fn == 1:
                        uid = content.decode('utf-8', errors='replace')
                    elif fn == 2:
                        sp = 0
                        _, sp = decode_varint(content, sp)
                        sl, sp = decode_varint(content, sp)
                        info_b64 = content[sp:sp + sl].decode('utf-8', errors='replace')
                elif wt == 0:
                    _, ep = decode_varint(entry, ep)
                else:
                    break

            if uid and info_b64:
                try:
                    raw_inner = base64.b64decode(info_b64)
                    inner_blobs[uid] = raw_inner
                    ip = 0
                    _, ip = decode_varint(raw_inner, ip)
                    il, ip = decode_varint(raw_inner, ip)
                    title = raw_inner[ip:ip + il].decode('utf-8', errors='replace')
                    titles[uid] = title
                except Exception:
                    pass
    except Exception:
        pass
    return titles, inner_blobs

def extract_existing_metadata_from_paths(db_paths):
    merged_titles = {}
    merged_inner = {}
    for db in db_paths:
        t, b = extract_existing_metadata(db)
        for k, v in t.items():
            if k not in merged_titles:
                merged_titles[k] = v
        for k, v in b.items():
            if k not in merged_inner:
                merged_inner[k] = v
    return merged_titles, merged_inner

def _collect_all_conversations():
    catalog = {}
    for cdir in _ALL_CONV_DIRS:
        if not os.path.isdir(cdir):
            continue
        try:
            for name in sorted(os.listdir(cdir)):
                lower = name.lower()
                if lower.endswith(".db") and not lower.endswith((".db-shm", ".db-wal")):
                    cid = name[:-3]
                    if cid not in catalog:
                        catalog[cid] = os.path.join(cdir, name)
                elif lower.endswith(".pb"):
                    cid = name[:-3]
                    if cid not in catalog:
                        catalog[cid] = os.path.join(cdir, name)
        except Exception:
            pass
    return catalog

def write_index_to_database(db_path, encoded_value):
    conn = sqlite3.connect(db_path, timeout=5.0)
    cur = conn.cursor()
    cur.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.trajectorySummaries'")
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE ItemTable SET value=? WHERE key='antigravityUnifiedStateSync.trajectorySummaries'", (encoded_value,))
    else:
        cur.execute("INSERT INTO ItemTable (key, value) VALUES ('antigravityUnifiedStateSync.trajectorySummaries', ?)", (encoded_value,))
    conn.commit()
    conn.close()

# ─── CLI Subcommands ─────────────────────────────────────────────────────────

def do_snapshot():
    if not DB_PATHS:
        print(json.dumps({"success": False, "error": "No state.vscdb found"}))
        return
    for db in DB_PATHS:
        titles, inner_blobs = extract_existing_metadata(db)
        if len(titles) > 0:
            try:
                conn = sqlite3.connect(db, timeout=5.0)
                cur = conn.cursor()
                cur.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.trajectorySummaries'")
                row = cur.fetchone()
                conn.close()
                if row and row[0]:
                    val = row[0]
                    # Check if snapshot file already exists and has more entries
                    if os.path.exists(SNAPSHOT_INFO_FILE):
                        try:
                            with open(SNAPSHOT_INFO_FILE, "r", encoding="utf-8") as f:
                                old_info = json.load(f)
                                if old_info.get("count", 0) > len(titles):
                                    # Never overwrite a rich snapshot with a degraded/smaller one
                                    print(json.dumps({
                                        "success": True,
                                        "action": "snapshot_skipped",
                                        "reason": f"Current count {len(titles)} is less than snapshot count {old_info.get('count', 0)}",
                                        "count": old_info.get("count", 0)
                                    }))
                                    return
                        except Exception:
                            pass

                    os.makedirs(os.path.dirname(SNAPSHOT_FILE), exist_ok=True)
                    with open(SNAPSHOT_FILE, "w", encoding="utf-8") as sf:
                        sf.write(val)
                    info = {
                        "count": len(titles),
                        "timestamp": time.time(),
                        "isoTime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "dbPath": db
                    }
                    with open(SNAPSHOT_INFO_FILE, "w", encoding="utf-8") as inf:
                        json.dump(info, inf, indent=2)

                    print(json.dumps({"success": True, "action": "snapshot", "count": len(titles)}))
                    return
            except Exception as e:
                print(json.dumps({"success": False, "error": str(e)}))
                return
    print(json.dumps({"success": False, "error": "No trajectorySummaries with conversations found"}))

def do_check():
    existing_titles, existing_inner = extract_existing_metadata_from_paths(DB_PATHS)
    conv_catalog = _collect_all_conversations()

    indexed_ids = set(existing_inner.keys())
    disk_ids = set(conv_catalog.keys())
    missing_ids = [cid for cid in disk_ids if cid not in indexed_ids]

    # Sort missing by newest first
    timestamps = {cid: get_conversation_effective_timestamp(conv_catalog[cid])[0] or 0 for cid in missing_ids}
    missing_ids.sort(key=lambda cid: timestamps.get(cid, 0), reverse=True)

    snapshot_count = 0
    snapshot_time = 0
    if os.path.exists(SNAPSHOT_INFO_FILE):
        try:
            with open(SNAPSHOT_INFO_FILE, "r", encoding="utf-8") as f:
                info = json.load(f)
                snapshot_count = info.get("count", 0)
                snapshot_time = info.get("timestamp", 0)
        except Exception:
            pass

    print(json.dumps({
        "success": True,
        "indexedCount": len(indexed_ids),
        "diskCount": len(disk_ids),
        "missingCount": len(missing_ids),
        "missingIds": missing_ids[:20],
        "hasSnapshot": os.path.exists(SNAPSHOT_FILE),
        "snapshotCount": snapshot_count,
        "snapshotTimestamp": snapshot_time
    }))

def do_sync_missing():
    if not DB_PATHS:
        print(json.dumps({"success": False, "error": "No state.vscdb found"}))
        return
    existing_titles, existing_inner = extract_existing_metadata_from_paths(DB_PATHS)
    conv_catalog = _collect_all_conversations()

    indexed_ids = set(existing_inner.keys())
    disk_ids = set(conv_catalog.keys())
    missing_ids = [cid for cid in disk_ids if cid not in indexed_ids]

    if not missing_ids:
        print(json.dumps({"success": True, "addedCount": 0, "message": "Everything already in sync"}))
        return

    known_ws = load_known_workspace_uris()
    new_entries = []
    added_info = []

    for cid in missing_ids:
        conv_path = conv_catalog[cid]
        source_is_db = conv_path.lower().endswith(".db")
        prompt = extract_prompt_from_conversation_db(conv_path) if source_is_db else None
        title = format_prompt_title(prompt) if prompt else None
        if not title:
            title = get_title_from_brain(cid)
        if not title:
            mtime = time.strftime("%b %d", time.localtime(os.path.getmtime(conv_path)))
            title = f"Conversation ({mtime}) {cid[:8]}"

        mtime_sec, is_exact = get_conversation_effective_timestamp(conv_path)
        ws_inferred = infer_workspace_from_brain(cid, known_ws)

        entry = build_trajectory_entry(cid, title, None, ws_inferred, mtime_sec, source_is_db, is_exact)
        new_entries.append((cid, entry, mtime_sec or 0))
        added_info.append({"id": cid, "title": title, "workspace": ws_inferred})

    # Read existing binary trajectory payload
    db = DB_PATHS[0]
    conn = sqlite3.connect(db, timeout=5.0)
    cur = conn.cursor()
    cur.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.trajectorySummaries'")
    row = cur.fetchone()
    conn.close()

    existing_bytes = base64.b64decode(row[0]) if row and row[0] else b""
    new_bytes = b""
    for _, entry, _ in new_entries:
        new_bytes += encode_length_delimited(1, entry)

    # Prepend new entries so recent missing chats appear at the top
    combined = new_bytes + existing_bytes
    encoded = base64.b64encode(combined).decode('utf-8')

    for db_path in DB_PATHS:
        try:
            write_index_to_database(db_path, encoded)
        except Exception:
            pass

    print(json.dumps({
        "success": True,
        "addedCount": len(new_entries),
        "added": added_info[:10]
    }))

def do_restore_snapshot():
    if not os.path.exists(SNAPSHOT_FILE):
        print(json.dumps({"success": False, "error": "No snapshot file exists"}))
        return
    with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
        val = f.read().strip()
    if not val:
        print(json.dumps({"success": False, "error": "Snapshot file is empty"}))
        return
    for db_path in DB_PATHS:
        try:
            write_index_to_database(db_path, val)
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            return
    print(json.dumps({"success": True, "action": "restore_snapshot"}))

def do_rebuild():
    if not DB_PATHS:
        print(json.dumps({"success": False, "error": "No state.vscdb found"}))
        return
    conv_catalog = _collect_all_conversations()
    if not conv_catalog:
        print(json.dumps({"success": False, "error": "No conversations on disk"}))
        return

    existing_titles, existing_inner = extract_existing_metadata_from_paths(DB_PATHS)
    effective_ts = {cid: get_conversation_effective_timestamp(p) for cid, p in conv_catalog.items()}
    sorted_cids = sorted(conv_catalog.keys(), key=lambda cid: (effective_ts[cid][0] or 0), reverse=True)

    known_ws = load_known_workspace_uris()
    result_bytes = b""

    for cid in sorted_cids:
        path = conv_catalog[cid]
        source_is_db = path.lower().endswith(".db")
        inner_data = existing_inner.get(cid)
        title = existing_titles.get(cid)
        if not title:
            prompt = extract_prompt_from_conversation_db(path) if source_is_db else None
            title = format_prompt_title(prompt) if prompt else None
        if not title:
            title = get_title_from_brain(cid)
        if not title:
            mtime = time.strftime("%b %d", time.localtime(os.path.getmtime(path)))
            title = f"Conversation ({mtime}) {cid[:8]}"

        mtime_sec, is_exact = effective_ts.get(cid, (None, False))
        ws_path = None
        if not (inner_data and extract_workspace_hint(inner_data)):
            ws_path = infer_workspace_from_brain(cid, known_ws)

        entry = build_trajectory_entry(cid, title, inner_data, ws_path, mtime_sec, source_is_db, is_exact)
        result_bytes += encode_length_delimited(1, entry)

    encoded = base64.b64encode(result_bytes).decode('utf-8')
    for db_path in DB_PATHS:
        try:
            write_index_to_database(db_path, encoded)
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            return

    print(json.dumps({"success": True, "action": "rebuild", "totalCount": len(sorted_cids)}))

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: helper.py <snapshot|check|sync-missing|restore-snapshot|rebuild>"}))
        sys.exit(1)

    cmd = sys.argv[1].lower()
    if cmd == "snapshot":
        do_snapshot()
    elif cmd == "check":
        do_check()
    elif cmd == "sync-missing":
        do_sync_missing()
    elif cmd == "restore-snapshot":
        do_restore_snapshot()
    elif cmd == "rebuild":
        do_rebuild()
    else:
        print(json.dumps({"error": f"Unknown command: {cmd}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
