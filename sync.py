#!/usr/bin/env python3
"""
Pull Belgium Diamonds inventory, apply your markup, and write the
public inventory file the website reads.

  python3 sync.py            # full sync (lab + natural)
  python3 sync.py --dry-run  # fetch and report, don't write

Cost math: Belgium's Buy_Price is PER CARAT.  stone cost = Buy_Price x Weight.
Your cost and the API key never go into public/ -- only retail prices do.
"""
import json, math, os, sys, time, csv, urllib.request, urllib.parse
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
API = "https://api.belgiumdia.com/api/v1/inventory/diamond"
PUBLIC_FILE = os.path.join(ROOT, "public", "inventory.json")
PRIVATE_DIR = os.path.join(ROOT, "data")

FANCY_CODES = {"Y": "Yellow", "P": "Pink", "B": "Blue", "G": "Green", "O": "Orange",
               "BR": "Brown", "BK": "Black", "W": "White", "GY": "Gray", "V": "Violet", "R": "Red"}
WHITE_COLORS = set("DEFGHIJKLMN")


def load_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def fail(msg):
    """Print a GitHub-visible error annotation and stop."""
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::error title=Sync failed::{msg}")
    sys.exit(msg)


def api_key():
    k = (os.environ.get("BELGIUM_API_KEY") or "").strip() or (load_json(os.path.join(ROOT, "config", "secrets.json"), {}) or {}).get("belgium_api_key")
    # Tolerate a pasted URL, "key=...", quotes or stray spaces around the key.
    if k and "key=" in k:
        k = urllib.parse.parse_qs(urllib.parse.urlparse(k if "?" in k else "?" + k).query).get("key", [k])[0]
    k = (k or "").strip().strip('"').strip("'").strip()
    if not k:
        fail("No API key. Put it in config/secrets.json or set the BELGIUM_API_KEY secret.")
    return k


def fetch_page(kind, page, key, tries=4):
    url = API + "?" + urllib.parse.urlencode({"type": kind, "page": page, "key": key})
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "diamond-site-sync/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                d = json.loads(r.read())
            if d.get("status") != 1:
                msg = d.get("message") or "API returned status 0"
                if "KEY" in msg.upper():
                    fail(f"Belgium Diamonds rejected the API key ({msg}). The saved key is {len(key)} characters "
                         f"starting '{key[:3]}'. Re-copy it from their User API page into the BELGIUM_API_KEY secret.")
                raise RuntimeError(msg)
            return d
        except Exception as e:
            if attempt == tries:
                code = getattr(e, "code", None)
                fail(f"Belgium Diamonds API error on {kind} page {page}: "
                     + (f"HTTP {code}" if code else str(e))
                     + (" (their server may be blocking GitHub's servers)" if code in (401, 403) else ""))
            print(f"  {kind} page {page} failed ({e}); retrying...")
            time.sleep(3 * attempt)


def fetch_all(kind, key):
    first = fetch_page(kind, 1, key)
    rows = list(first["data"])
    total_pages = int(first.get("total_page") or 1)
    print(f"{kind}: {first.get('total_results')} stones over {total_pages} pages")
    for p in range(2, total_pages + 1):
        rows += fetch_page(kind, p, key)["data"]
        print(f"  page {p}/{total_pages} ({len(rows)} so far)")
    return rows


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_pricing():
    """Markup lives OUTSIDE the public repo: env MARKUP_SETTINGS (GitHub secret) or config/markup.json."""
    env = (os.environ.get("MARKUP_SETTINGS") or "").strip()
    if env:
        # Macs often turn straight quotes into curly ones when pasting.
        env = env.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace("\u2019", "'")
        try:
            return json.loads(env)
        except ValueError as e:
            fail(f"MARKUP_SETTINGS secret is not valid JSON ({e}). Re-paste it exactly as given.")
    p = load_json(os.path.join(ROOT, "config", "markup.json"))
    if p:
        return p
    print("WARNING: no markup settings found; using 50% on everything.")
    return {"markup_tiers": [{"cost_up_to": None, "markup_percent": 50}], "round_up_to": 10, "min_profit_dollars": 0}


def markup_for(cost, s):
    for t in s.get("markup_tiers") or []:
        if t.get("cost_up_to") is None or cost <= t["cost_up_to"]:
            return t["markup_percent"]
    return s.get("markup_percent", 50)


def retail_price(cost, s):
    pct = markup_for(cost, s)
    price = cost * (1 + pct / 100.0)
    price = max(price, cost + s.get("min_profit_dollars", 0))
    step = s.get("round_up_to") or 1
    return int(math.ceil(price / step) * step)


def shape_name(s):
    s = (s or "").strip()
    if not s:
        return "Other"
    return " ".join(w.capitalize() for w in s.lower().split())


def color_name(r):
    c = (r.get("Color") or "").strip().upper()
    if c in WHITE_COLORS:
        return c, False
    fc = (r.get("FancyColor") or "").strip().upper()
    hue = FANCY_CODES.get(fc, fc.title()) if fc else c.title()
    parts = [(r.get("Fancy_Color_Intensity") or "").strip().title(),
             (r.get("FancyColorOvertone") or "").strip().title(), hue]
    return "Fancy " + " ".join(p for p in parts if p), True


def build(raw_by_kind, s):
    public, private = [], []
    skipped = 0
    for kind, rows in raw_by_kind.items():
        # Optional per-type pricing: {"lab": {...}, "natural": {...}} overrides the shared settings.
        sk = {**s, **(s.get(kind) or {})}
        for r in rows:
            carat, per_ct = num(r.get("Weight")), num(r.get("Buy_Price"))
            if carat <= 0 or per_ct <= 0:
                skipped += 1
                continue
            cost = round(per_ct * carat, 2)
            price = retail_price(cost, sk)
            color, fancy = color_name(r)
            sid = str(r.get("Stock_No"))
            public.append([
                sid, "L" if kind == "lab" else "N", shape_name(r.get("Shape")), round(carat, 2),
                color, int(fancy), (r.get("Clarity") or "").upper(),
                (r.get("Cut_Grade") or "").upper(), (r.get("Polish") or "").upper(), (r.get("Symmetry") or "").upper(),
                (r.get("Fluorescence_Intensity") or "").upper(), (r.get("Lab") or "").upper(),
                r.get("Measurements") or "", num(r.get("Ratio")), num(r.get("DEPTH_PER")), num(r.get("TABLE_PER")),
                (r.get("Treatment") or "").upper(),
                r.get("ImageLink") or "", r.get("Video_HTML") or r.get("VideoLink") or "", r.get("CertificateLink") or "",
                price,
            ])
            private.append({"stock_no": sid, "type": kind, "shape": r.get("Shape"), "carat": carat,
                            "color": color, "clarity": r.get("Clarity"), "lab": r.get("Lab"),
                            "per_carat_cost": per_ct, "stone_cost": cost, "markup_pct": markup_for(cost, sk),
                            "retail": price, "profit": round(price - cost, 2)})
    return public, private, skipped


FIELDS = ["id", "type", "shape", "carat", "color", "fancy", "clarity", "cut", "polish", "symmetry",
          "fluor", "lab", "measurements", "ratio", "depth", "table", "treatment",
          "image", "video", "cert", "price"]


def main():
    dry = "--dry-run" in sys.argv
    s = load_json(os.path.join(ROOT, "config", "settings.json"), {})
    s.update(load_pricing())
    key = api_key()
    raw = {k: fetch_all(k, key) for k in s.get("inventory_types", ["lab", "natural"])}
    public, private, skipped = build(raw, s)
    print(f"Built {len(public)} stones ({skipped} skipped: missing weight or price)")

    # Safety: never wipe the site because of a bad fetch.
    prev = load_json(PUBLIC_FILE)
    if prev and len(public) < 0.5 * len(prev.get("rows", [])):
        fail(f"Refusing to publish: only {len(public)} stones vs {len(prev['rows'])} last time. Check the feed.")
    if dry:
        print("Dry run: nothing written.")
        return

    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "store": {k: s.get(k, "") for k in ("store_name", "contact_email", "contact_phone")},
           "fields": FIELDS, "rows": public}
    os.makedirs(os.path.dirname(PUBLIC_FILE), exist_ok=True)
    tmp = PUBLIC_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    os.replace(tmp, PUBLIC_FILE)

    os.makedirs(PRIVATE_DIR, exist_ok=True)
    with open(os.path.join(PRIVATE_DIR, "cost_and_margin.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(private[0].keys()))
        w.writeheader(); w.writerows(private)
    print(f"Wrote {PUBLIC_FILE} ({os.path.getsize(PUBLIC_FILE)//1024} KB) and data/cost_and_margin.csv")


if __name__ == "__main__":
    main()
