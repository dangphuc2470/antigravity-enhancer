#!/usr/bin/env python3
import sqlite3
import os
import glob
import json
import sys

def decode_proto(buf):
    offset = 0
    def decode_varint():
        nonlocal offset
        res = 0
        shift = 0
        while offset < len(buf):
            byte = buf[offset]
            offset += 1
            res |= (byte & 0x7f) << shift
            if (byte & 0x80) == 0:
                break
            shift += 7
        return res

    fields = {}
    while offset < len(buf):
        tag = decode_varint()
        fn = tag >> 3
        wt = tag & 0x07
        if wt == 0:
            val = decode_varint()
            fields[fn] = val
        elif wt == 2:
            ln = decode_varint()
            data = buf[offset:offset+ln]
            offset += ln
            fields[fn] = data
        elif wt == 1:
            offset += 8
        elif wt == 5:
            offset += 4
        else:
            break
    return fields

def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(0)

    db_files = []
    for a in args:
        if os.path.isfile(a):
            db_files.append(a)
        elif os.path.isdir(a):
            db_files.extend(glob.glob(os.path.join(a, "*.db")))

    res = {}
    for db in db_files:
        cid = os.path.basename(db)[:-3]
        try:
            con = sqlite3.connect(db)
            cur = con.cursor()
            title = None
            ws = None
            cur.execute("SELECT data FROM trajectory_metadata_blob LIMIT 1")
            row = cur.fetchone()
            if row and row[0]:
                f = decode_proto(row[0])
                if 7 in f and isinstance(f[7], bytes) and f[7].startswith(b"file://"):
                    ws = f[7].decode("utf-8", errors="ignore")
                elif 1 in f and isinstance(f[1], bytes):
                    f1 = decode_proto(f[1])
                    if 1 in f1 and isinstance(f1[1], bytes) and f1[1].startswith(b"file://"):
                        ws = f1[1].decode("utf-8", errors="ignore")
                if not ws:
                    b = row[0]
                    idx = b.find(b"file:///")
                    if idx != -1:
                        end = idx
                        while end < len(b) and 32 < b[end] < 127 and b[end] not in b"\"'<>":
                            end += 1
                        ws = b[idx:end].decode("utf-8", errors="ignore")

            cur.execute("SELECT step_payload FROM steps WHERE step_type=23 ORDER BY idx ASC LIMIT 1")
            row = cur.fetchone()
            if row and row[0]:
                f = decode_proto(row[0])
                if 30 in f and isinstance(f[30], bytes):
                    f30 = decode_proto(f[30])
                    if 4 in f30 and isinstance(f30[4], bytes):
                        raw_title = f30[4].decode("utf-8", errors="ignore").split("\n")[0].strip()
                        if raw_title:
                            title = raw_title
            con.close()
            if title or ws:
                res[cid] = {"title": title, "workspace": ws}
        except Exception:
            pass
    print(json.dumps(res))

if __name__ == "__main__":
    main()
