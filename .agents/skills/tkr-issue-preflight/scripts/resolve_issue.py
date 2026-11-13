#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
"""resolve_issue — turn a GitHub issue number into the one internal ticket that carries it.

Reads the whole BMad ticket store (every `tickets.toml`, every ticket file and every plan under
`{output_folder}`) and answers: which ticket has `tracker_id = "#N"`, where is its plan, and what
reference does stock BMad's `tickets.py find` take for it. It only reads. It never calls GitHub and
never creates, edits or renames anything.

It fails closed (exit 1, JSON with `ok: false` and a `code` on stdout, one line on stderr) when the
store is malformed, when no ticket carries the number, when more than one ticket does, when the
carriers of one ticket disagree, or when the ticket's plan is ambiguous.

Exit 0: resolved. Exit 1: failed closed. Exit 2: bad command line.
"""

import argparse
import importlib.util
import json
import os
import re
import shlex
import subprocess
import sys
import tomllib
import unicodedata
from pathlib import Path

sys.dont_write_bytecode = True

LEAF_TYPES = ("story", "spike", "bug")
CONTAINER_TYPES = ("initiative", "epic")
BREAKDOWN = "tickets.toml"
ID_RE = re.compile(r"^[0-9A-Za-z]+$")
NUMBER_RE = re.compile(r"^#?([0-9]+)$")
ISSUE_URL_RE = re.compile(r"^https://github\.com/([^/\s]+/[^/\s]+)/(issues|pull)/([0-9]+)/?$", re.I)
REMOTE_RE = re.compile(r"^https://github\.com/([^/\s]+/[^/\s]+)/issues/([0-9]+)/?$", re.I)
FRONTMATTER_RE = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)
KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$")
QUOTED_RE = re.compile(r"""^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)')\s*(?:\s#.*)?$""")
SKIP_DIRS = {"node_modules", "__pycache__"}


class Fail(Exception):
    """A fail-closed answer: `code` is stable, `message` is for a person, `data` joins the JSON."""

    def __init__(self, code: str, message: str, **data):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


# ---------------------------------------------------------------- reading


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as e:
        raise Fail("malformed_store", f"cannot read {path}: {e}") from e


def scalar(raw: str) -> str:
    """A frontmatter value as text: quotes removed, a trailing comment dropped."""
    value = raw.strip()
    m = QUOTED_RE.match(value)
    if m:
        return m.group(1) if m.group(1) is not None else m.group(2).replace("''", "'")
    value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
    return "" if value.startswith("#") else value  # an unquoted `#123` is a YAML comment


def parse_frontmatter(text: str) -> tuple[dict | None, bool]:
    """(top-level scalar keys, False); (None, False) with no frontmatter; (None, True) when it never closes."""
    if not text.startswith("---"):
        return None, False
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None, True
    fm = {}
    for line in m.group(1).splitlines():
        k = KEY_RE.match(line)
        if k:
            fm[k.group(1)] = scalar(k.group(2))
    return fm, False


def bare_id(value):
    """An id as the tree compares it: digits are the number, letters-and-digits a string, else None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and ID_RE.match(value) and value not in ("true", "false"):
        return int(value) if value.isdigit() else value
    return None


def tracker_number(value, where: str) -> int | None:
    """`#123`, `123` or the TOML number 123 as 123; empty as None; anything else is a malformed store."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise Fail("malformed_store", f"{where}: tracker_id {value!r} is not a GitHub issue number")
    if isinstance(value, int):
        n = value
    else:
        m = NUMBER_RE.match(str(value).strip())
        if not m:
            raise Fail("malformed_store", f"{where}: tracker_id {value!r} is not a GitHub issue number like \"#123\"")
        n = int(m.group(1))
    if n < 1:
        raise Fail("malformed_store", f"{where}: tracker_id {value!r} is not a GitHub issue number")
    return n


def title_slug(title: str) -> str:
    title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60].rstrip("-") or "untitled"


def walk_error(error: OSError) -> None:
    """A folder that cannot be listed could hold the duplicate, so a failed walk fails the lookup."""
    raise Fail("malformed_store", f"cannot read {error.filename}: {error.strerror or error}") from error


class Store:
    """Everything the ticket store says about tickets, plans and tracker ids."""

    def __init__(self, root: Path):
        self.root = root
        self.dirs: dict[Path, dict] = {}
        self.carriers: list[dict] = []  # one per tracker_id written down anywhere
        self.plans: list[dict] = []
        self._scan()

    def _dir(self, d: Path) -> dict:
        return self.dirs.setdefault(
            d, {"entries": [], "epic_rows": [], "leaves": [], "plans": [], "container": None, "breakdown": None}
        )

    def rel(self, path: Path) -> str:
        try:
            return str(path.relative_to(self.root))
        except ValueError:
            return str(path)

    def _scan(self) -> None:
        for base, dirnames, filenames in os.walk(self.root, onerror=walk_error):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS)
            d = Path(base)
            if BREAKDOWN in filenames:
                self._read_breakdown(d, d / BREAKDOWN)
            for name in sorted(filenames):
                if name.endswith(".md"):
                    self._read_markdown(d, d / name)
        for d, info in self.dirs.items():
            ids: dict = {}
            for leaf in info["leaves"]:
                if leaf["id"] is not None:
                    if leaf["id"] in ids:
                        raise Fail(
                            "malformed_store",
                            f"{self.rel(ids[leaf['id']])} and {self.rel(leaf['path'])} share the ticket id {leaf['id']}",
                        )
                    ids[leaf["id"]] = leaf["path"]
        self._carriers()

    def _read_breakdown(self, d: Path, path: Path) -> None:
        where = self.rel(path)
        try:
            data = tomllib.loads(read_text(path))
        except tomllib.TOMLDecodeError as e:
            raise Fail("malformed_store", f"{where}: {e}") from e
        info = self._dir(d)
        info["breakdown"] = path
        for table in ("entry", "epic"):
            rows = data.get(table, [])
            if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
                raise Fail("malformed_store", f"{where}: write `[[{table}]]` tables, one per {table}")
            seen = set()
            for order, row in enumerate(rows):
                rid = bare_id(row.get("id"))
                if rid is None:
                    raise Fail("malformed_store", f"{where}: every {table} needs an `id`: a number, or letters and digits")
                if rid in seen:
                    raise Fail("malformed_store", f"{where}: two {table} tables with id {rid}")
                seen.add(rid)
                number = tracker_number(row.get("tracker_id"), f"{where} {table} {rid}")
                if table == "entry":
                    kind = row.get("type")
                    if kind not in LEAF_TYPES:
                        raise Fail("malformed_store", f"{where}: entry {rid} type {kind!r} is not one of {', '.join(LEAF_TYPES)}")
                    info["entries"].append(
                        {
                            "id": rid,
                            "type": kind,
                            "title": str(row.get("title", "")),
                            "number": number,
                            "order": order,
                            "path": path,
                            "remote": str(row.get("remote", "") or ""),
                        }
                    )
                else:
                    slug = row.get("slug")
                    if not isinstance(slug, str) or not slug:
                        raise Fail("malformed_store", f"{where}: epic {rid} needs a `slug`")
                    if any(r["slug"] == slug for r in info["epic_rows"]):
                        raise Fail("malformed_store", f"{where}: two epic tables with slug {slug}")
                    info["epic_rows"].append(
                        {
                            "id": rid,
                            "slug": slug,
                            "title": str(row.get("title", "")),
                            "number": number,
                            "path": path,
                            "remote": str(row.get("remote", "") or ""),
                        }
                    )

    def _read_markdown(self, d: Path, path: Path) -> None:
        text = read_text(path)
        fm, unclosed = parse_frontmatter(text)
        name = path.name
        is_plan = fm is not None and "ticket" in fm and (fm.get("type", "") not in LEAF_TYPES or name.endswith("-plan.md"))
        ticket_named = re.match(r"^(story|spike|bug)-.+\.md$", name) or name == f"{d.name}.md"
        if unclosed and ticket_named:
            raise Fail("malformed_store", f"{self.rel(path)}: frontmatter does not close")
        if fm is None:
            return
        where = self.rel(path)
        kind = fm.get("type", "")
        if is_plan:
            number = None
            try:
                number = tracker_number(fm.get("tracker_id"), where)
            except Fail:
                pass  # a plan's own note is evidence, not store identity
            plan = {"path": path, "dir": d, "ticket": fm["ticket"], "number": number, "status": fm.get("status", "")}
            self._dir(d)["plans"].append(plan)
            self.plans.append(plan)
        elif kind in LEAF_TYPES:
            leaf_id = None
            if fm.get("id", "") != "":
                leaf_id = bare_id(fm["id"])
                if leaf_id is None:
                    raise Fail("malformed_store", f"{where}: id {fm['id']!r} is not a number, or letters and digits")
            self._dir(d)["leaves"].append(
                {
                    "path": path,
                    "id": leaf_id,
                    "type": kind,
                    "title": fm.get("title", ""),
                    "number": tracker_number(fm.get("tracker_id"), where),
                    "remote": fm.get("remote", ""),
                }
            )
        elif kind in CONTAINER_TYPES:
            if name != f"{d.name}.md":
                return  # a container's file is named after its folder; a differently named file is not one
            self._dir(d)["container"] = {
                "path": path,
                "type": kind,
                "title": fm.get("title", ""),
                "number": tracker_number(fm.get("tracker_id"), where),
                "remote": fm.get("remote", ""),
            }

    # ------------------------------------------------------------ identities

    def _carriers(self) -> None:
        """Every written-down tracker id, with the identity it names: a leaf is `leaf:<folder>:<id>` (its
        entry and its file are one ticket; a file with no id is its own), an epic is `epic:<folder>`."""
        for d, info in self.dirs.items():
            for e in info["entries"]:
                self._carrier(e["number"], "entry", e["path"], ("leaf", d, e["id"]), e["remote"])
            for leaf in info["leaves"]:
                ident = leaf["id"] if leaf["id"] is not None else leaf["path"].name
                self._carrier(leaf["number"], "leaf-file", leaf["path"], ("leaf", d, ident), leaf["remote"])
            for row in info["epic_rows"]:
                self._carrier(row["number"], "epic-row", row["path"], ("epic", d / row["slug"], None), row["remote"])
            c = info["container"]
            if c:
                form = "initiative-file" if c["type"] == "initiative" else "epic-file"
                self._carrier(c["number"], form, c["path"], (c["type"], d, None), c["remote"])

    def _carrier(self, number, form, path, key, remote="") -> None:
        # Every carrier is kept, even without a number: a ticket's other carriers disagreeing about it is a conflict.
        self.carriers.append({"number": number, "form": form, "path": path, "key": key, "remote": remote})

    # --------------------------------------------------------------- queries

    def holders(self, number: int) -> dict:
        """identity key -> carriers of that ticket, for the tickets that carry `number` anywhere."""
        keys = [c["key"] for c in self.carriers if c["number"] == number]
        out: dict = {}
        for key in keys:
            if key not in out:
                out[key] = [c for c in self.carriers if c["key"] == key]
        return out

    def epic_id(self, folder: Path) -> int | str | None:
        parent = self.dirs.get(folder.parent)
        if not parent:
            return None
        for row in parent["epic_rows"]:
            if row["slug"] == folder.name:
                return row["id"]
        return None

    def mentions(self, number: int) -> list[str]:
        return sorted(
            self.rel(p["path"])
            for p in self.plans
            if p["number"] == number or re.fullmatch(rf"#{number}", p["ticket"].strip())
        )

    def plan_join(self, plan: dict):
        """The identity key a plan joins by its `ticket`, else None: an id joins the entry in the plan's folder,
        a file stem joins that pulled leaf, `#N` joins the ticket carrying N wherever it lives."""
        info = self.dirs.get(plan["dir"], {})
        raw = plan["ticket"].strip()
        m = re.fullmatch(r"#([0-9]+)", raw)
        if m:
            keys = {c["key"] for c in self.carriers if c["number"] == int(m.group(1))}
            return next(iter(keys)) if len(keys) == 1 else None
        ident = bare_id(raw)
        if ident is not None and any(e["id"] == ident for e in info.get("entries", [])):
            return ("leaf", plan["dir"], ident)
        if ident is not None and any(lf["id"] == ident for lf in info.get("leaves", [])):
            return ("leaf", plan["dir"], ident)
        for leaf in info.get("leaves", []):
            if raw and raw == leaf["path"].stem:
                return ("leaf", plan["dir"], leaf["id"] if leaf["id"] is not None else leaf["path"].name)
        return None


# ---------------------------------------------------------------- resolving


def parse_reference(text: str, repo: str | None) -> int:
    ref = text.strip()
    m = NUMBER_RE.match(ref)
    if m:
        n = int(m.group(1))
    else:
        u = ISSUE_URL_RE.match(ref)
        if not u:
            raise Fail("bad_reference", f"{text!r} is not an issue reference: give #123, 123 or an issue URL")
        if u.group(2).lower() != "issues":
            raise Fail("bad_reference", f"{text!r} is a pull request, not an issue")
        if not repo:
            raise Fail("bad_reference", "an issue URL needs the repository: pass --repo owner/name")
        if u.group(1).lower() != repo.lower():
            raise Fail("wrong_repository", f"{text!r} is in {u.group(1)}, not {repo}")
        n = int(u.group(3))
    if n < 1:
        raise Fail("bad_reference", f"{text!r} is not an issue number")
    return n


def leaf_stem(store: Store, d: Path, entry: dict | None, leaf: dict | None) -> str:
    """The leaf file's stem, or the one `tickets.py pull` gives it: `<type>-<slug of the title>`, with `-<id>`
    when an earlier unpulled entry or a file in the folder already has that name."""
    if leaf:
        return leaf["path"].stem
    info = store.dirs[d]
    pulled = {lf["id"] for lf in info["leaves"] if lf["id"] is not None}
    stem = f"{entry['type']}-{title_slug(entry['title'])}"
    taken = {lf["path"].stem for lf in info["leaves"]}
    for other in info["entries"]:
        if other is entry:
            break
        if other["id"] not in pulled:
            taken.add(f"{other['type']}-{title_slug(other['title'])}")
    return f"{stem}-{entry['id']}" if stem in taken else stem


def check_holder(number: int, carriers: list[dict], store: Store, repo: str | None) -> None:
    """One ticket's carriers must agree on the number, and each `remote` must be the issue URL of that number in
    the project's repository."""
    for c in carriers:
        where = store.rel(c["path"])
        if c["number"] is not None and c["number"] != number:
            raise Fail(
                "tracker_id_conflict",
                f"#{number} is on {store.rel(next(x for x in carriers if x['number'] == number)['path'])} but the same "
                f"ticket's {c['form']} {where} says #{c['number']}",
                carriers=[{"form": x["form"], "path": store.rel(x["path"]), "tracker_id": x["number"]} for x in carriers],
            )
        remote = (c["remote"] or "").strip()
        if not remote:
            continue
        m = REMOTE_RE.match(remote)
        if not m:
            raise Fail("bad_remote", f"{where}: remote {remote!r} is not a GitHub issue URL like https://github.com/owner/name/issues/123")
        if int(m.group(2)) != number:
            raise Fail("tracker_id_conflict", f"{where} carries #{number} but its remote names issue {m.group(2)}")
        if repo and m.group(1).lower() != repo.lower():
            raise Fail("wrong_repository", f"{where} carries #{number} but its remote is in {m.group(1)}, not {repo}")


def resolve(store: Store, number: int, repo: str | None = None) -> dict:
    holders = store.holders(number)
    if not holders:
        raise Fail(
            "not_found",
            f"no ticket carries tracker_id \"#{number}\"; do not create an issue or a ticket to make this resolve",
            mentions=store.mentions(number),
        )
    if len(holders) > 1:
        raise Fail(
            "duplicate_tracker_id",
            f"tracker_id \"#{number}\" is on {len(holders)} different tickets",
            tickets=[
                [{"form": c["form"], "path": store.rel(c["path"])} for c in cs if c["number"] == number]
                for cs in holders.values()
            ],
        )
    (key, carriers), = holders.items()
    check_holder(number, carriers, store, repo)
    layer, folder, ident = key
    out = {
        "ok": True,
        "issue": f"#{number}",
        "number": number,
        "layer": layer,
        "carriers": [
            {"form": c["form"], "path": store.rel(c["path"]), "tracker_id": c["number"]} for c in carriers
        ],
    }
    if layer == "leaf":
        out.update(resolve_leaf(store, number, folder, ident))
    else:
        out.update(resolve_container(store, layer, folder))
    return out


def resolve_leaf(store: Store, number: int, d: Path, ident) -> dict:
    info = store.dirs[d]
    entry = next((e for e in info["entries"] if e["id"] == ident), None)
    leaf = next(
        (lf for lf in info["leaves"] if (lf["id"] == ident if lf["id"] is not None else lf["path"].name == ident)),
        None,
    )
    if entry is None and leaf is None:
        raise Fail("malformed_store", f"internal: no ticket for {ident!r} in {d}")
    entry_id = entry["id"] if entry else leaf["id"]
    kind = leaf["type"] if leaf else entry["type"]
    title = (leaf["title"] if leaf and leaf["title"] else entry["title"] if entry else "")
    stem = leaf_stem(store, d, entry, leaf)
    key_name = f"{d.name}/{entry_id}" if entry_id is not None else f"{d.name}/{leaf['path'].name}"
    epic_id = store.epic_id(d)
    ticket_key = ("leaf", d, ident)

    joined = [p for p in info["plans"] if store.plan_join(p) == ticket_key]
    joined += [
        p
        for p in store.plans
        if p["dir"] != d and store.plan_join(p) == ticket_key and re.fullmatch(r"#[0-9]+", p["ticket"].strip())
    ]
    for p in store.plans:
        if p["number"] == number and p not in joined:
            other = store.plan_join(p)
            if other is not None and other != ticket_key:
                raise Fail(
                    "plan_identity_conflict",
                    f"{store.rel(p['path'])} names #{number} in its tracker_id but its ticket {p['ticket']!r} joins another ticket",
                )
    warnings = [
        f"{store.rel(p['path'])} names #{number} in its tracker_id but its ticket {p['ticket']!r} joins no ticket; it is not this ticket's plan"
        for p in store.plans
        if p["number"] == number and p not in joined and store.plan_join(p) is None
    ]
    if len(joined) > 1:
        raise Fail(
            "multiple_plans",
            f"#{number} has {len(joined)} plans: {', '.join(store.rel(p['path']) for p in joined)}",
            plans=[store.rel(p["path"]) for p in joined],
        )
    expected = d / f"{stem}-plan.md"
    if joined:
        plan = {
            "path": str(joined[0]["path"]),
            "exists": True,
            "status": joined[0]["status"] or None,
            "joined_by": f"ticket: {joined[0]['ticket']}",
        }
    else:
        if expected.exists():
            raise Fail(
                "plan_path_collision",
                f"{store.rel(expected)} exists but its frontmatter `ticket` does not name this ticket",
                path=str(expected),
            )
        plan = {"path": str(expected), "exists": False, "status": None, "joined_by": None}

    stock_dir, stock_ref = d, None
    if epic_id is not None and entry_id is not None:
        stock_dir, stock_ref = d.parent, f"{epic_id}.{entry_id}"
    elif entry_id is not None:
        stock_ref = str(entry_id)
    else:
        stock_ref = leaf["path"].name
    return {
        "key": key_name,
        "kind": kind,
        "title": title,
        "buildable": True,
        "epic": d.name,
        "epic_id": epic_id,
        "entry_id": entry_id,
        "folder": str(d),
        "leaf_file": str(leaf["path"]) if leaf else None,
        "plan": plan,
        "stock": {"dir": str(stock_dir), "ref": stock_ref},
        "warnings": warnings,
    }


def merged_tracker(numbers: list) -> dict:
    """A child's tracker id from every place that writes one: the one number they agree on, else none, with the
    disagreeing numbers named so the child is not shown with a guess."""
    seen = sorted({n for n in numbers if n is not None})
    if len(seen) > 1:
        return {"tracker_id": None, "tracker_id_conflict": seen}
    return {"tracker_id": seen[0] if seen else None}


def resolve_container(store: Store, layer: str, d: Path) -> dict:
    info = store.dirs.get(d, {})
    c = info.get("container")
    if layer == "epic":
        parent = store.dirs.get(d.parent, {})
        row = next((r for r in parent.get("epic_rows", []) if r["slug"] == d.name), None)
        children = []
        leaves = {lf["id"]: lf for lf in info.get("leaves", []) if lf["id"] is not None}
        for e in info.get("entries", []):
            leaf = leaves.get(e["id"])
            children.append(
                {
                    "entry_id": e["id"],
                    "file": leaf["path"].name if leaf else None,
                    "type": leaf["type"] if leaf else e["type"],
                    "title": (leaf["title"] if leaf and leaf["title"] else e["title"]),
                    **merged_tracker([e["number"], leaf["number"] if leaf else None]),
                }
            )
        listed = {e["id"] for e in info.get("entries", [])}
        for lf in info.get("leaves", []):
            if lf["id"] is None or lf["id"] not in listed:
                children.append(
                    {
                        "entry_id": lf["id"],
                        "file": lf["path"].name,
                        "type": lf["type"],
                        "title": lf["title"],
                        **merged_tracker([lf["number"]]),
                    }
                )
        title = (c or {}).get("title") or (row or {}).get("title") or ""
        extra = {"epic": d.name, "epic_id": row["id"] if row else None}
    else:
        children = []
        rows = info.get("epic_rows", [])
        for r in rows:
            container = store.dirs.get(d / r["slug"], {}).get("container")
            children.append(
                {
                    "epic": r["slug"],
                    "epic_id": r["id"],
                    "title": (container["title"] if container and container["title"] else r["title"]),
                    **merged_tracker([r["number"], container["number"] if container else None]),
                }
            )
        slugs = {r["slug"] for r in rows}
        for folder, other in sorted(store.dirs.items()):
            box = other.get("container")
            if folder.parent == d and folder.name not in slugs and box and box["type"] == "epic":
                children.append(
                    {"epic": folder.name, "epic_id": None, "title": box["title"], **merged_tracker([box["number"]])}
                )
        title = (c or {}).get("title") or ""
        extra = {"initiative": d.name}
    return {
        "key": d.name,
        "kind": layer,
        "title": title,
        "buildable": False,
        **extra,
        "folder": str(d),
        "container_file": str(c["path"]) if c else None,
        "children": children,
        "stock": None,
        "warnings": [],
        "next": f"this {layer} is a container, not a leaf: pick one of its children and preflight that child's issue",
    }


# ---------------------------------------------------------------- project and stock BMad


def find_project_root(start: Path) -> Path | None:
    for p in [start, *start.parents]:
        if (p / "_bmad").is_dir():
            return p
    return None


def load_project(root: Path) -> tuple[Path, str | None, str | None]:
    """(ticket store folder, GitHub repo, active initiative name) from the project's BMad config."""
    utils = root / "_bmad" / "scripts" / "config_utils.py"
    if not utils.is_file():
        raise Fail("bad_config", f"cannot read the BMad config: {utils} is missing")
    spec = importlib.util.spec_from_file_location("bmad_config_utils", utils)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        config = module.load_central_config(root)
    except module.ConfigError as e:
        raise Fail("bad_config", str(e)) from e
    core = config.get("core", {}) if isinstance(config.get("core"), dict) else {}
    output = str(core.get("output_folder", "")).replace("{project-root}", str(root))
    if not output:
        raise Fail("bad_config", "core.output_folder is not set in the BMad config")
    store = (root / output).resolve()
    active = core.get("active_initiative")
    repo = None
    store_cfg = root / "_bmad" / "custom" / "ticketing-store-config.toml"
    if store_cfg.is_file():
        try:
            tickets = tomllib.loads(read_text(store_cfg)).get("tickets", {})
        except tomllib.TOMLDecodeError as e:
            raise Fail("bad_config", f"{store_cfg}: {e}") from e
        if isinstance(tickets, dict) and isinstance(tickets.get("repo"), str):
            repo = tickets["repo"]
    return store, repo, active if isinstance(active, str) and active.strip() else None


def stock_join(script: Path, folder: str, ref: str) -> str | None:
    """The file name of the plan stock's own reader joins to the ticket `ref` names, else None. `find` cannot say:
    it prints the path a plan would have whether or not one was joined."""
    spec = importlib.util.spec_from_file_location("bmad_stock_tickets", script)
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        row = module.resolve_ticket(module.load_tree(Path(folder)), ref)
    except (module.TicketError, OSError, ValueError, AttributeError) as e:
        raise Fail("stock_unreadable", f"stock reader could not join the plan of {ref}: {e}") from e
    return row.get("plan")


def check_stock(root: Path, result: dict) -> dict:
    """Ask the project's stock `tickets.py find` for the same ticket and compare. A leaf only."""
    script = root / "_bmad" / "method" / "scripts" / "tickets.py"
    if not script.is_file():
        raise Fail("stock_unreadable", f"stock BMad tickets.py is missing: {script}")
    stock = result["stock"]
    proc = subprocess.run(
        [sys.executable, str(script), "--project-root", str(root), "find", stock["dir"], stock["ref"]],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        try:
            reason = json.loads(proc.stdout).get("error", "")
        except ValueError:
            reason = ""
        raise Fail(
            "stock_unreadable",
            f"stock `tickets.py find {stock['ref']}` failed: {reason or proc.stderr.strip() or proc.stdout.strip()}",
        )
    try:
        found = json.loads(proc.stdout)
    except ValueError as e:
        raise Fail("stock_unreadable", f"stock `tickets.py find` printed no JSON: {e}") from e
    # Stock reads a tracker id only from a pulled leaf file, so an entry-only ticket legitimately comes back with
    # none. Empty is "stock does not know"; a non-empty id that differs is a conflict.
    stock_tracker = ""
    if found.get("tracker_id") not in (None, ""):
        try:
            stock_tracker = f"#{tracker_number(found['tracker_id'], 'stock tracker_id')}"  # 101, "101" and "#101" agree
        except Fail:
            stock_tracker = str(found["tracker_id"])
    if stock_tracker and stock_tracker != result["issue"]:
        raise Fail(
            "stock_disagrees",
            f"stock `tickets.py find {stock['ref']}` names tracker id {stock_tracker}; the preflight resolved {result['issue']}",
            stock={"tracker_id": stock_tracker},
            preflight={"tracker_id": result["issue"]},
        )
    plan = result["plan"]
    ours = {
        "ref": stock["ref"],
        "epic": result["epic"],
        "id": result["entry_id"],
        "plan": str(Path(plan["path"]).resolve()),
        "plan_exists": plan["exists"],
        # The plan file stock must have joined to the ticket, or None when there is no plan.
        "plan_joined": Path(plan["path"]).name if plan["exists"] else None,
    }
    theirs = {
        "ref": found.get("ref"),
        "epic": found.get("epic"),
        "id": found.get("id"),
        "plan": str(Path(found["plan"]).resolve()) if found.get("plan") else None,
        # `find` names a plan path even when no plan is joined, so the file on disk and the plan stock
        # actually joined are read separately.
        "plan_exists": bool(found.get("plan")) and Path(found["plan"]).is_file(),
        "plan_joined": stock_join(script, stock["dir"], stock["ref"]),
    }
    if plan["exists"]:
        # With a plan, stock's status is the plan's; an absent status key reads as empty on both sides.
        ours["status"] = plan["status"] or ""
        theirs["status"] = str(found.get("status") or "")
    if result["entry_id"] is None:  # a file the breakdown does not number is named by its file name
        ours["file"] = Path(result["leaf_file"]).name
        theirs["file"] = found.get("file")
    if ours != theirs:
        raise Fail(
            "stock_disagrees",
            f"stock `tickets.py find {stock['ref']}` names {theirs}; the preflight names {ours}",
            stock=theirs,
            preflight=ours,
        )
    return {
        "checked": True,
        "agrees": True,
        "ref": stock["ref"],
        "dir": stock["dir"],
        "stock_tracker_id": stock_tracker or None,
        "plan_joined": theirs["plan_joined"],
        "plan_status": theirs.get("status"),
    }


def handoff(result: dict, active: str | None, store_dir: Path, store: Store, root: Path | None) -> dict:
    """How to pass the ticket on. Stock's bare `find <ref>` looks only in the active initiative and then `backlog/`,
    so a bare reference is offered only when that lookup provably lands on this ticket; otherwise the folder and
    reference travel together."""
    stock = result["stock"]
    if stock is None:
        return {}
    home = Path(result["folder"])
    if result.get("epic_id") is not None:
        in_active = None if active is None else (home.parent.name == active and home.parent.parent == store_dir)
        bare_safe = bool(in_active)
    else:
        in_active = None
        # A backlog file name is found by stock only after the active initiative has had its turn, and an initiative
        # file of the same name would win.
        clash = active is None or any(
            lf["path"].name == stock["ref"]
            for folder, info in store.dirs.items()
            if folder == store_dir / active or (store_dir / active) in folder.parents
            for lf in info["leaves"]
        )
        bare_safe = home == store_dir / "backlog" and not clash and stock["ref"].endswith(".md")
    out = {
        "bmad_build_input": stock["ref"] if bare_safe else None,
        "scoped": {"dir": stock["dir"], "ref": stock["ref"]},
        "active_initiative": active,
        "in_active_initiative": in_active,
    }
    if root is not None:
        script = root / "_bmad" / "method" / "scripts" / "tickets.py"
        out["stock_find"] = shlex.join(
            ["uv", "run", str(script), "--project-root", str(root), "find", stock["dir"], stock["ref"]]
        )
    if not bare_safe:
        out["note"] = (
            "a bare reference would not reliably reach this ticket: stock searches only the active initiative and "
            "backlog/. Use the scoped dir and ref, or set the active initiative"
            if active
            else "no active initiative is set, so stock cannot resolve a bare reference. Use the scoped dir and ref"
        )
    return out


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("issue", help="#123, 123, or a GitHub issue URL")
    parser.add_argument("--project-root", help="the project holding _bmad/; default: the nearest one at or above the working directory")
    parser.add_argument("--store", help="the ticket store folder to read, instead of the project's output_folder")
    parser.add_argument("--repo", help="owner/name the issue URL must belong to; default: the store config's repo")
    parser.add_argument(
        "--check-stock",
        action="store_true",
        help="also run the project's stock `tickets.py find` on the stock reference and fail unless it names the same tracker id and plan",
    )
    args = parser.parse_args(argv)

    try:
        root = Path(args.project_root).resolve() if args.project_root else find_project_root(Path.cwd())
        repo, active = args.repo, None
        if args.store:
            store_dir = Path(args.store).resolve()
        else:
            if root is None:
                raise Fail("bad_config", "no project root: no _bmad/ at or above the working directory; pass --project-root or --store")
            store_dir, cfg_repo, active = load_project(root)
            repo = repo or cfg_repo
        if args.check_stock and root is None:
            raise Fail("bad_config", "--check-stock needs the project root: pass --project-root")
        if not store_dir.is_dir():
            raise Fail("bad_config", f"the ticket store is not a folder: {store_dir}")
        number = parse_reference(args.issue, repo)
        store = Store(store_dir)
        result = resolve(store, number, repo)
        # A root only inferred from the working directory says nothing about a store passed by hand.
        result["handoff"] = handoff(result, active, store_dir, store, root if args.project_root or not args.store else None)
        if args.check_stock:
            if result["buildable"]:
                result["stock_check"] = check_stock(root, result)
            else:
                result["stock_check"] = {
                    "checked": False,
                    "reason": f"this {result['kind']} is a container; stock `find` resolves leaf tickets only",
                }
    except Fail as e:
        print(json.dumps({"ok": False, "code": e.code, "error": e.message, **e.data}, indent=2, ensure_ascii=False))
        print(f"{e.code}: {e.message}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
