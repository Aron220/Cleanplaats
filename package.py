#!/usr/bin/env python3
"""
Bouwt het zip-bestand voor de Chrome Web Store en addons.mozilla.org.

Twee dingen die misgaan als je met de hand zipt, en die dit script voorkomt:

  1. manifest.json moet in de wortel van het archief staan. Zip je de map zelf,
     dan zit alles een niveau te diep en weigeren beide winkels het bestand.
  2. De repo bevat meer dan de extensie: de Worker (server/), de git-historie,
     editorinstellingen, Playwright-screenshots. Niets daarvan hoort bij een
     gebruiker terecht te komen, en server/ al helemaal niet — dat is een
     aparte private repo die hier alleen toevallig naast ligt.

Wat er wél in gaat is bewust een lijst en geen "alles behalve": een nieuw
bestand in content/ of background/ gaat vanzelf mee, wat vrijwel altijd de
bedoeling is, maar nieuwe rommel in de wortel niet.

Draaien:  python3 package.py
"""

import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).parent.resolve()

# Losse bestanden en hele mappen die de extensie vormen.
FILES = [
    "manifest.json",
    "background.js",
    "content.js",
    "theme-init.js",
    "purify.min.js",
    "content.css",
    "dark-mode.css",
    "LICENSE",
]
DIRS = ["background", "content", "icons"]

# Wordt door geen enkel bestand geladen, maar zit wel in web_accessible_resources
# ("icons/*") en zou dus zonder reden aan elke Marktplaats-pagina blootgesteld
# worden. Weglaten in plaats van meesturen.
SKIP = {"icons/cleanplaats_icon.png"}


def collect():
    """Elk bestand dat mee moet, als pad relatief aan de repo-wortel."""
    members = []
    for name in FILES:
        path = ROOT / name
        if not path.exists():
            sys.exit(f"ontbreekt: {name}")
        members.append(name)

    for folder in DIRS:
        base = ROOT / folder
        if not base.is_dir():
            sys.exit(f"ontbreekt: {folder}/")
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            # Verborgen bestanden (.DS_Store, editor-swapfiles) nooit meesturen.
            if any(part.startswith(".") for part in path.relative_to(ROOT).parts):
                continue
            rel = path.relative_to(ROOT).as_posix()
            if rel not in SKIP:
                members.append(rel)
    return members


def check_manifest(members):
    """
    De winkel weigert een archief waarin het manifest naar iets wijst dat er
    niet in zit, en dat merk je pas na het uploaden. Hier merken is sneller.
    """
    manifest = json.loads((ROOT / "manifest.json").read_text())
    referenced = set()

    background = manifest.get("background", {})
    referenced.update(background.get("scripts", []))
    if "service_worker" in background:
        referenced.add(background["service_worker"])

    for script in manifest.get("content_scripts", []):
        referenced.update(script.get("js", []))
        referenced.update(script.get("css", []))

    referenced.update(manifest.get("icons", {}).values())
    referenced.update(manifest.get("action", {}).get("default_icon", {}).values())

    for entry in manifest.get("web_accessible_resources", []):
        for resource in entry.get("resources", []):
            if not resource.endswith("*"):
                referenced.add(resource)

    missing = sorted(referenced - set(members))
    if missing:
        sys.exit("manifest verwijst naar bestanden die niet in de zip zitten:\n  " + "\n  ".join(missing))

    return manifest["version"]


def main():
    members = collect()
    version = check_manifest(members)

    out = ROOT / f"cleanplaats-{version}.zip"
    # ZIP_DEFLATED: de winkels accepteren opgeslagen bestanden ook, maar een
    # kleiner archief uploadt sneller en telt mee voor de pakketlimiet.
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in members:
            archive.write(ROOT / name, name)

    print(f"{out.name} — {out.stat().st_size / 1024:.0f} KB, {len(members)} bestanden\n")
    for name in members:
        print(f"  {name}")


if __name__ == "__main__":
    main()
