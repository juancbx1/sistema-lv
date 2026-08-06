from pathlib import Path
import re

# Collect actual file basenames (lowercase map)
files = {}
for p in Path("public/src").rglob("*"):
    if p.suffix in {".ts", ".tsx", ".js", ".jsx"}:
        files.setdefault(p.name.lower(), []).append(p.as_posix())

# Find import paths whose last segment doesn't match exact case of an existing file
pat = re.compile(r"""from\s+['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]""")
issues = []
for p in Path("public/src").rglob("*"):
    if p.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
        continue
    text = p.read_text(encoding="utf-8", errors="replace")
    for m in pat.finditer(text):
        rel = m.group(1) or m.group(2)
        if not rel:
            continue
        # resolve relative to file
        base = (p.parent / rel).resolve()
        # try with extensions
        candidates = [base]
        if not base.suffix:
            for ext in [".tsx", ".ts", ".jsx", ".js", ""]:
                candidates.append(Path(str(base) + ext))
                candidates.append(base / ("index" + ext))
        exists = any(c.exists() for c in candidates)
        if exists:
            continue
        # case-insensitive match?
        name = Path(rel).name
        if not name:
            continue
        low = name.lower()
        # strip query
        for ext in ["", ".tsx", ".ts", ".jsx", ".js"]:
            key = (name + ext).lower() if not Path(name).suffix else name.lower()
            if key in files or name.lower() in files:
                issues.append((p.as_posix(), rel, files.get(name.lower()) or files.get(key)))
                break

print("potential case issues:", len(issues))
for i in issues[:40]:
    print(i)
