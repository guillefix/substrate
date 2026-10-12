"""Rebuild compact scientific illustration references using only the stdlib.

Run from the repository root: python scripts/import_biology.py
Sources have separate usage terms; see docs/visual-assets.md.
"""
from collections import defaultdict
from datetime import date
import hashlib
import json
from pathlib import Path
import urllib.request

DEST = Path(__file__).resolve().parents[1] / "public/assets/biology"


def download(url):
    data = urllib.request.urlopen(url, timeout=40).read()
    return data.decode(), hashlib.sha256(data).hexdigest()


def save(name, content):
    target = DEST / name
    target.write_text(json.dumps(content, separators=(",", ":")) + "\n")
    print(f"{name}: {target.stat().st_size:,} bytes")


def pdb(identifier):
    url = f"https://files.rcsb.org/download/{identifier}.pdb1"
    text, digest = download(url)
    secondary = {}
    for line in text.splitlines():
        if line.startswith("HELIX "):
            chain, start, end = line[19], int(line[21:25]), int(line[33:37])
            for residue in range(start, end + 1):
                secondary[chain, residue] = "H"
        elif line.startswith("SHEET "):
            chain, start, end = line[21], int(line[22:26]), int(line[33:37])
            for residue in range(start, end + 1):
                secondary[chain, residue] = "E"
    chains = defaultdict(list)
    model = 1
    for line in text.splitlines():
        if line.startswith("MODEL "):
            model = int(line[10:14])
        if line.startswith("ATOM  ") and line[12:16].strip() == "CA" and line[16] in " A":
            chain, residue = line[21], int(line[22:26])
            # [x,y,z,residue,secondary-structure] in original Angstrom coordinates.
            chains[f"{model}:{chain}"].append([
                float(line[30:38]), float(line[38:46]), float(line[46:54]),
                residue, secondary.get((chain, residue), "C")])
    count = sum(len(points) for points in chains.values())
    expected = 1433 if identifier == "6J8J" else 2864
    assert count == expected, f"Source revision changed residue count: {count} != {expected}"
    assert len(chains) == (3 if identifier == "6J8J" else 8)
    save(identifier.lower() + '.json', {"pdb": identifier, "assembly": 1, "unit": "angstrom",
         "selection": "protein C-alpha atoms; first alternate location; all assembly models",
         "chains": dict(chains)})
    return {"id": identifier, "url": url, "sha256": digest, "assembly": 1,
            "chains": list(chains), "residues": count,
            "sourcePage": f"https://www.rcsb.org/structure/{identifier}",
            "terms": "https://www.rcsb.org/pages/usage-policy", "license": "CC0-1.0"}


def morphology():
    url = "https://api.brain-map.org/api/v2/well_known_file_download/491119539"
    text, digest = download(url)
    nodes = []
    for line in text.splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        row = line.split()
        nodes.append([int(row[0]), int(row[1]), *map(float, row[2:6]), int(row[6])])
    assert len(nodes) == 2620
    save('allen-464212183.json', {"specimen": 464212183, "unit": "micrometer",
         "kind": "mouse dendrite-focused reconstruction, including short axon stub", "columns": ["id", "type", "x", "y", "z", "radius", "parent"], "nodes": nodes})
    return {"id": "Allen-464212183", "url": url, "sha256": digest, "nodes": len(nodes),
            "sourcePage": "https://celltypes.brain-map.org/experiment/morphology/464212183",
            "terms": "https://alleninstitute.org/legal/terms-of-use",
            "citationPolicy": "https://alleninstitute.org/legal/citation-policy",
            "license": "Allen Institute terms: research or other noncommercial use; see linked terms"}


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    sources = [pdb('6J8J'), pdb('3LUT'), morphology()]
    save('manifest.json', {"retrieved": str(date.today()), "sources": sources,
         "processing": "Coordinates retained; C-alpha reduction and SWC column conversion. Renderer transforms are visual only."})


if __name__ == '__main__':
    main()
