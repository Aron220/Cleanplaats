#!/usr/bin/env python3
"""
Zet de extensie klaar in de vorm die Safari nodig heeft.

De bestanden in de repo blijven zoals ze zijn: Chrome en Firefox draaien daar
direct op. Dit script maakt er een kopie van (standaard safari/build/extension)
met de paar verschillen die Safari vraagt:

  1. De rechten krijgen declarativeNetRequestWithHostAccess erbij. Safari voert
     een redirect-regel alleen uit voor een extensie die dat recht heeft, en de
     instelling "resultaten per pagina" is zo'n regel (background/url-rules.js).
  2. De achtergrond draait als pagina (background.scripts), net als in Firefox,
     in plaats van als service worker. Dat is het pad waarvoor de keep-alive in
     background/keepalive.js geschreven is, en in Safari het makkelijkst te
     inspecteren.
  3. Drie kleine scripts uit safari/extension/ gaan mee. Safari kent
     webNavigation.onHistoryStateUpdated niet; twee ervan melden hetzelfde
     moment vanaf de pagina. Het derde, safari/background.js, vangt dat op in
     de achtergrond en zorgt dat blokkeerregels één voor één worden bijgewerkt
     en ook echt zijn opgeslagen, waar Safari bij het opstarten anders over
     struikelt. Het laadt direct na het script dat browserAPI definieert.
  4. safari/scroll-guard.js gaat mee als content script. Na het sluiten van de
     fotoviewer blijft de pagina in Safari soms op slot staan; dat script
     haalt een slot weg waar geen venster meer bij hoort.
  5. De Firefox-sleutels onder browser_specific_settings gaan eruit en Safari
     18.4 wordt de ondergrens: de oudste versie die initiatorDomains in
     blokkeerregels kent. Zonder die voorwaarde zouden de regels op elke site
     gelden in plaats van alleen op Marktplaats, 2dehands en 2ememain.

Welke bestanden bij de extensie horen staat op één plek: collect() in
package.py, het script dat ook de zip voor de winkels bouwt. Een nieuw bestand
in content/ of background/ gaat dus vanzelf mee.

Draaien:  python3 safari/stage.py [doelmap]
          python3 safari/stage.py --fix-project <map met .xcodeproj> <bundle-id>
"""

import copy
import json
import pathlib
import re
import shutil
import sys

sys.dont_write_bytecode = True

HERE = pathlib.Path(__file__).parent.resolve()
ROOT = HERE.parent
SHIMS = HERE / "extension"
DEFAULT_OUT = HERE / "build" / "extension"

# De map waarin de Safari-scripts in de extensie terechtkomen.
SHIM_DIR = "safari"
MAIN_WORLD_SHIMS = ["history-bridge.js"]
ISOLATED_SHIMS = ["history-relay.js"]
# Laadt als de pagina er staat, na de content scripts van de extensie zelf.
PAGE_SHIMS = ["scroll-guard.js"]
BACKGROUND_SHIMS = ["background.js"]

SAFARI_MIN_VERSION = "18.4"
REDIRECT_PERMISSION = "declarativeNetRequestWithHostAccess"


def extension_files():
    """Elk bestand van de extensie, als pad relatief aan de repo-wortel."""
    sys.path.insert(0, str(ROOT))
    try:
        import package
    except ImportError as error:
        sys.exit(f"package.py is niet te laden ({error}); stage.py leunt op de bestandslijst daarin.")
    if not hasattr(package, "collect"):
        sys.exit("package.py heeft geen collect() meer; pas extension_files() in safari/stage.py aan.")
    return package.collect()


def browser_api_script_index(scripts):
    """
    safari/background.js legt een laag over browserAPI en moet dus laden nadat
    die variabele bestaat, en voordat een ander script hem gebruikt. Het script
    dat hem definieert wordt hier opgezocht in plaats van bij naam genoemd,
    zodat een hernoemd bestand geen stille fout wordt.
    """
    definition = re.compile(r"^\s*(?:var|let|const)\s+browserAPI\s*=", re.M)
    for index, name in enumerate(scripts):
        path = ROOT / name
        if path.is_file() and definition.search(path.read_text(encoding="utf-8")):
            return index
    sys.exit(
        "geen background-script gevonden dat browserAPI definieert; "
        "safari/extension/background.js en safari/stage.py moeten daarop worden aangepast."
    )


def safari_manifest(manifest):
    result = copy.deepcopy(manifest)

    permissions = result.setdefault("permissions", [])
    if REDIRECT_PERMISSION not in permissions:
        permissions.append(REDIRECT_PERMISSION)

    scripts = list(result.get("background", {}).get("scripts") or [])
    if not scripts:
        sys.exit("manifest.json heeft geen background.scripts; daar bouwt de Safari-versie op.")
    position = browser_api_script_index(scripts) + 1
    shims = [f"{SHIM_DIR}/{name}" for name in BACKGROUND_SHIMS]
    result["background"] = {"scripts": scripts[:position] + shims + scripts[position:]}

    matches = list(result.get("host_permissions") or [])
    if not matches:
        sys.exit("manifest.json heeft geen host_permissions.")
    result["content_scripts"] = [
        {
            "matches": matches,
            "js": [f"{SHIM_DIR}/{name}" for name in MAIN_WORLD_SHIMS],
            "run_at": "document_start",
            "world": "MAIN",
        },
        {
            "matches": matches,
            "js": [f"{SHIM_DIR}/{name}" for name in ISOLATED_SHIMS],
            "run_at": "document_start",
        },
    ] + list(result.get("content_scripts") or []) + [
        {
            "matches": matches,
            "js": [f"{SHIM_DIR}/{name}" for name in PAGE_SHIMS],
            "run_at": "document_end",
        },
    ]

    result["browser_specific_settings"] = {"safari": {"strict_min_version": SAFARI_MIN_VERSION}}
    return result


def referenced_files(manifest):
    """Alles waar het manifest naar wijst, zoals check_manifest() in package.py."""
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
    return referenced


def stage(out):
    out = pathlib.Path(out).resolve()
    if out == ROOT or out in ROOT.parents:
        sys.exit(f"{out} is de repo zelf of een map erboven; kies een eigen doelmap.")

    members = [name for name in extension_files() if name != "manifest.json"]
    manifest = safari_manifest(json.loads((ROOT / "manifest.json").read_text(encoding="utf-8")))

    # Altijd vanaf nul: een bestand dat upstream verdwenen is mag niet in een
    # oude kopie blijven liggen en zo toch in Safari belanden.
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    for name in members:
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)

    shims = MAIN_WORLD_SHIMS + ISOLATED_SHIMS + PAGE_SHIMS + BACKGROUND_SHIMS
    (out / SHIM_DIR).mkdir(exist_ok=True)
    for name in shims:
        source = SHIMS / name
        if not source.is_file():
            sys.exit(f"ontbreekt: safari/extension/{name}")
        shutil.copyfile(source, out / SHIM_DIR / name)

    (out / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    missing = sorted(name for name in referenced_files(manifest) if not (out / name).is_file())
    if missing:
        sys.exit("het Safari-manifest verwijst naar bestanden die niet zijn klaargezet:\n  " + "\n  ".join(missing))

    count = sum(1 for path in out.rglob("*") if path.is_file())
    print(f"Cleanplaats {manifest['version']} voor Safari klaargezet: {count} bestanden in {out}")
    return manifest["version"]


def fix_pbxproj(text, bundle_id, extension_id):
    """project.pbxproj: geeft de aangepaste tekst terug en de id's die er dan in staan."""
    id_pattern = re.compile(r'(PRODUCT_BUNDLE_IDENTIFIER = )("?[^";]+"?);')
    # Eén blok buildSettings per target en configuratie. De extensie herken je
    # aan haar huidige id, of anders aan wat Xcode alleen een app-extensie
    # meegeeft: een eigen Info.plist-map en een zoekpad vier mappen omhoog.
    block_pattern = re.compile(r'buildSettings = \{.*?\n\t*\};', re.S)
    extension_marks = ('Extension/Info.plist', '@executable_path/../../../../Frameworks')

    def fix_block(block_match):
        block = block_match.group(0)
        found = id_pattern.search(block)
        if not found:
            return block
        is_extension = found.group(2).strip('"').endswith('.Extension') or any(mark in block for mark in extension_marks)
        wanted = extension_id if is_extension else bundle_id
        return id_pattern.sub(lambda match: f'{match.group(1)}"{wanted}";', block)

    fixed = block_pattern.sub(fix_block, text)
    return fixed, {match.group(2).strip('"') for match in id_pattern.finditer(fixed)}


def fix_xcproj(text, bundle_id, extension_id):
    """project.xcproj: hetzelfde voor het JSON-formaat van Xcode 27.2."""
    id_pattern = re.compile(r'("PRODUCT_BUNDLE_IDENTIFIER(?:\[[^"]*\])?"\s*:\s*)"((?:[^"\\]|\\.)*)"')
    # Elk target noemt eerst zijn "product-type" en daarna zijn build-settings.
    # De extensie herken je aan haar huidige id, of anders aan dat type.
    types = [(match.start(), match.group(1)) for match in re.finditer(r'"product-type"\s*:\s*"([^"]*)"', text)]

    def fix_id(match):
        product_type = ""
        for position, name in types:
            if position > match.start():
                break
            product_type = name
        is_extension = match.group(2).endswith('.Extension') or 'extension' in product_type
        return match.group(1) + json.dumps(extension_id if is_extension else bundle_id)

    fixed = id_pattern.sub(fix_id, text)
    return fixed, {json.loads(f'"{match.group(2)}"') for match in id_pattern.finditer(fixed)}


def fix_project(project_dir, bundle_id):
    """
    De converter leidt de bundle-id van de app soms af van de appnaam en geeft
    alleen de extensie de id die je meegeeft. Lopen die twee uit elkaar, dan
    weigert Xcode de build ("Embedded binary's bundle identifier is not
    prefixed with the parent app's bundle identifier"). Hier krijgen app en
    extensie altijd <id> en <id>.Extension, en de Swift-code die de extensie
    bij naam opzoekt dezelfde naam.

    De converter schrijft het project in het formaat van zijn Xcode: tot en met
    Xcode 27.1 is dat project.pbxproj, Xcode 27.2 maakt project.xcproj (JSON).
    """
    project_dir = pathlib.Path(project_dir)
    extension_id = f"{bundle_id}.Extension"

    fixers = {"project.pbxproj": fix_pbxproj, "project.xcproj": fix_xcproj}
    projects = sorted(path for name in fixers for path in project_dir.rglob(name))
    if not projects:
        sys.exit(f"geen {' of '.join(fixers)} gevonden onder {project_dir}")

    for project in projects:
        text = project.read_text(encoding="utf-8")
        fixed, ids = fixers[project.name](text, bundle_id, extension_id)
        if ids != {bundle_id, extension_id}:
            sys.exit(f"onverwachte bundle-id's in {project}: {sorted(ids)}")
        if fixed != text:
            project.write_text(fixed, encoding="utf-8")

    for swift in project_dir.rglob("*.swift"):
        text = swift.read_text(encoding="utf-8")
        fixed = re.sub(
            r'(extensionBundleIdentifier\s*=\s*)"[^"]*"',
            lambda match: f'{match.group(1)}"{extension_id}"',
            text,
        )
        if fixed != text:
            swift.write_text(fixed, encoding="utf-8")

    print(f"Bundle-id's gezet: {bundle_id} en {extension_id}")


def main(argv):
    if len(argv) >= 2 and argv[1] == "--fix-project":
        if len(argv) != 4:
            sys.exit("gebruik: stage.py --fix-project <map met .xcodeproj> <bundle-id>")
        fix_project(argv[2], argv[3])
        return
    if len(argv) > 2 or (len(argv) == 2 and argv[1].startswith("-")):
        sys.exit(__doc__.strip())
    stage(argv[1] if len(argv) == 2 else DEFAULT_OUT)


if __name__ == "__main__":
    main(sys.argv)
