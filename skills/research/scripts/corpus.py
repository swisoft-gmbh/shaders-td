#!/usr/bin/env python3
"""Read-only lexical retrieval over the bundled, hash-verified archive subset."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import sys

SKILL = Path(__file__).resolve().parent.parent
PLUGIN = SKILL.parent.parent
CORPUS = SKILL / "references/corpus"


def load(name):
    return json.loads((CORPUS / name).read_text())


def safe_source(record):
    p = (PLUGIN / record["path"]).resolve()
    if not p.is_relative_to(CORPUS.resolve()) or p.is_symlink():
        raise ValueError("Source path escapes the corpus")
    raw = p.read_bytes()
    if hashlib.sha256(raw).hexdigest() != record["sha256"]:
        raise ValueError(f'Hash mismatch: {record["id"]}')
    return raw.decode("utf-8")


def tokens(s):
    # Split camelCase identifiers so code and prose share useful terms.
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", s)
    return re.findall(r"[a-z0-9]{2,}", s.lower())


LIVE_NOTE = ("Not bundled: no redistribution licence. Fetch the live bundle (live_url); if it no "
             "longer resolves, open demo_page and take the current chunk URL from its HTML. Read "
             "for reference, quote only short excerpts, and do not copy it into outputs.")


def live_sources(records):
    """List the deployed demo bundles, which are linked, not bundled."""
    return [{"source_id": r["id"], "live_url": r["live_url"], "demo_page": r.get("demo_page"),
             "sha256": r["sha256"], "note": LIVE_NOTE}
            for r in records.values() if r["kind"] == "deployed-code"]


def search(args, records):
    if args.kind == "deployed":
        return live_sources(records)
    query = tokens(args.query)
    if not query:
        return []
    candidates, df = [], Counter()
    cache = {}
    for chunk in load("chunks.json"):
        r = records[chunk["source_id"]]
        if r.get("distributed") is False:
            continue
        if args.kind == "article" and r["kind"] not in ("article", "method-context"):
            continue
        if args.kind == "code" and r["kind"] not in ("code", "historical-code"):
            continue
        if args.kind == "glossary" and r["kind"] != "derived-glossary":
            continue
        if args.source and args.source not in r["id"]:
            continue
        if r["id"] not in cache:
            cache[r["id"]] = safe_source(r).splitlines()
        content = "\n".join(cache[r["id"]][chunk["start"]-1:chunk["end"]])
        counts = Counter(tokens(content))
        df.update(counts.keys())
        candidates.append((r, chunk, content, counts, len(tokens(content))))
    if not candidates:
        return []
    avg = sum(x[4] for x in candidates) / len(candidates)
    ranked = []
    for r, chunk, content, counts, length in candidates:
        score = 0.0
        title_terms = set(tokens(chunk["title"]))
        for term in query:
            freq = counts[term]
            if freq:
                idf = math.log(1 + (len(candidates) - df[term] + .5) / (df[term] + .5))
                score += idf * freq * 2.2 / (freq + 1.2 * (.25 + .75 * length / max(avg, 1)))
            if term in title_terms:
                score += 1.0
        if not score:
            continue
        # Prefer authored explanations/code; the generated glossary is secondary.
        if r["kind"] == "derived-glossary" and args.kind == "all":
            score *= .35
        lines = content.splitlines()
        matches = [(chunk["start"] + i, line) for i, line in enumerate(lines)
                   if set(tokens(line)) & set(query)]
        excerpt = "\n".join(f"{i}: {line[:350]}" for i, line in matches[:4])
        ranked.append({"source_id": r["id"], "kind": r["kind"], "heading": chunk["title"],
                       "lines": [chunk["start"], chunk["end"]], "score": round(score, 4),
                       "excerpt": excerpt, "url": r["url"], "commit": r["commit"],
                       "sha256": r["sha256"]})
    return sorted(ranked, key=lambda r: (-r["score"], r["source_id"], r["lines"]))[:args.limit]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    p = subs.add_parser("search")
    p.add_argument("query")
    p.add_argument("--kind", choices=["article", "code", "deployed", "glossary", "all"], default="all",
                   help="deployed lists the live URLs of the demo-site bundles, which are not bundled")
    p.add_argument("--source", default="")
    p.add_argument("--limit", type=int, default=5)
    p = subs.add_parser("read")
    p.add_argument("source_id")
    p.add_argument("--start", type=int, default=1)
    p.add_argument("--end", type=int)
    p = subs.add_parser("article")
    p.add_argument("slug", nargs="?")
    subs.add_parser("verify")
    args = parser.parse_args()
    records = {r["id"]: r for r in load("manifest.json")["files"]}
    if args.command == "search":
        if not 1 <= args.limit <= 50:
            parser.error("--limit must be 1..50")
        result = search(args, records)
    elif args.command == "read":
        if args.source_id not in records:
            parser.error("Unknown source_id; use search or article")
        r = records[args.source_id]
        if r.get("distributed") is False:
            parser.error(f'{r["id"]} is not bundled (no redistribution licence). '
                         f'Read it at {r["live_url"]}' + (f' (demo page: {r["demo_page"]})' if r.get("demo_page") else ""))
        lines = safe_source(r).splitlines()
        end = args.end if args.end is not None else min(args.start + 119, len(lines))
        if args.start < 1 or end < args.start or end > len(lines) or end-args.start >= 400:
            parser.error("Use an existing range of 1..400 lines")
        result = {**r, "requested_lines": [args.start, end],
                  "text": "\n".join(f"{n}: {lines[n-1]}" for n in range(args.start, end+1))}
    elif args.command == "article":
        rows = load("articles.json")
        result = [r for r in rows if args.slug is None or r["slug"] == args.slug]
        if not result:
            parser.error("Unknown article slug")
    else:
        errors = []
        bundled = [r for r in records.values() if r.get("distributed") is not False]
        for r in bundled:
            try:
                safe_source(r)
            except (ValueError, OSError, UnicodeError) as e:
                errors.append(str(e))
        result = {"ok": not errors, "files_checked": len(bundled),
                  "not_distributed": len(records) - len(bundled), "errors": errors}
        print(json.dumps(result, indent=2))
        return 1 if errors else 0
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, UnicodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
