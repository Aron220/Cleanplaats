#!/bin/bash
#
# Bouwt Cleanplaats als Safari-extensie voor macOS en installeert de app.
#
#   safari/build.sh               bouwen, ondertekenen en installeren
#   safari/build.sh --update      eerst de nieuwste versie ophalen, dan bouwen
#   safari/build.sh --stage-only  alleen de extensiemap klaarzetten (geen Xcode
#                                 nodig), voor "Add Temporary Extension" in Safari
#   safari/build.sh --unsigned    zonder certificaat bouwen; dan moet na elke
#                                 herstart van Safari "Allow Unsigned
#                                 Extensions" opnieuw aan
#   safari/build.sh --no-open     na het installeren niets openen
#
# Omgevingsvariabelen: TEAM_ID (team waarmee ondertekend wordt), BUNDLE_ID,
# APP_NAME, INSTALL_DIR (standaard /Applications).
#
# Safari laadt een extensie alleen uit een Mac-app. Apple's converter maakt een
# Xcode-project met zo'n app om de extensie heen; dat project is wegwerp en
# wordt elke keer opnieuw gemaakt uit safari/build/extension. Zie
# safari/README.md.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/build"
STAGE="$BUILD/extension"
PROJECT_DIR="$BUILD/xcode"
DERIVED="$BUILD/derived"
LOG="$BUILD/xcodebuild.log"

APP_NAME="${APP_NAME:-Cleanplaats}"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"

UPDATE=0
STAGE_ONLY=0
UNSIGNED=0
OPEN_AFTER=1

info() { printf '==> %s\n' "$*"; }
die() { printf '\nFOUT: %s\n' "$*" >&2; exit 1; }

usage() {
    sed -n '3,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg; do
    case "$arg" in
        --update) UPDATE=1 ;;
        --stage-only) STAGE_ONLY=1 ;;
        --unsigned) UNSIGNED=1 ;;
        --no-open) OPEN_AFTER=0 ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; die "onbekende optie: $arg" ;;
    esac
done

case "$APP_NAME" in
    */*|*:*|.*|'') die "APP_NAME mag geen '/' of ':' bevatten en niet met een punt beginnen" ;;
esac

# --- nieuwste versie ophalen -------------------------------------------------

# In een fork heet de repo van de maker "upstream" en komt de code daarvandaan;
# in een gewone clone is dat "origin". Deze map voegt alleen bestanden toe en
# verandert er geen, dus samenvoegen met een eigen branch geeft geen conflicten.
update_checkout() {
    command -v git >/dev/null 2>&1 || die "git is niet gevonden"
    git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "$ROOT is geen git-checkout; --update kan daar niets ophalen"

    local remote=origin branch before
    if git -C "$ROOT" remote get-url upstream >/dev/null 2>&1; then
        remote=upstream
    fi
    branch="$(git -C "$ROOT" ls-remote --symref "$remote" HEAD 2>/dev/null | sed -n 's|^ref: refs/heads/\([^[:space:]]*\).*|\1|p' | head -1)"
    [ -n "$branch" ] || die "kon de hoofdbranch van $remote niet bepalen (geen netwerk?)"

    before="$(git -C "$ROOT" rev-parse HEAD)"
    info "Nieuwste versie ophalen van $remote/$branch..."

    # Op de hoofdbranch zelf is dit een fast-forward. Op een eigen branch wordt
    # het een merge-commit, en die heeft een naam nodig, ook op een Mac waar git
    # nog niet is ingesteld.
    if [ -n "$(git -C "$ROOT" config user.email || true)" ]; then
        git -C "$ROOT" pull --no-rebase --no-edit "$remote" "$branch" || update_failed
    else
        git -C "$ROOT" -c user.name="Cleanplaats Safari build" -c user.email="safari-build@localhost" \
            pull --no-rebase --no-edit "$remote" "$branch" || update_failed
    fi

    if [ "$before" = "$(git -C "$ROOT" rev-parse HEAD)" ]; then
        info "Er was niets nieuws; de huidige versie wordt opnieuw gebouwd."
    fi
}

update_failed() {
    cat >&2 <<'EOF'

Ophalen is mislukt. De twee gebruikelijke oorzaken:
  - Je hebt zelf bestanden van de extensie aangepast: zet dat opzij met
    "git stash" en probeer opnieuw.
  - Git meldt dat bestanden in safari/ overschreven zouden worden: dan levert
    Cleanplaats de Safari-ondersteuning inmiddels zelf. Verwijder je eigen map
    safari/, draai "git pull" en daarna safari/build.sh.
EOF
    die "git pull is mislukt, zie hierboven"
}

# --- extensiemap klaarzetten -------------------------------------------------

stage_extension() {
    command -v python3 >/dev/null 2>&1 || die "python3 is niet gevonden. Het zit bij Xcode en bij de Command Line Tools (xcode-select --install)."
    python3 "$HERE/stage.py" "$STAGE"
    VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$STAGE/manifest.json")"
}

# --- Xcode -------------------------------------------------------------------

require_xcode() {
    [ "$(uname -s)" = "Darwin" ] || die "de Safari-app kan alleen op een Mac gebouwd worden (gebruik --stage-only om alleen de extensiemap te maken)"

    # Eerst kijken waar de ontwikkeltools staan, en xcodebuild pas aanroepen
    # als daar een Xcode staat: zonder Xcode opent macOS bij xcodebuild een
    # venster dat de Command Line Tools wil installeren, en daar heeft dit
    # script niets aan. Zijn alleen die tools actief maar is Xcode wel
    # geïnstalleerd, dan wijst DEVELOPER_DIR er voor dit ene script naar, zonder
    # sudo xcode-select.
    local developer_dir="${DEVELOPER_DIR:-}"
    if [ -z "$developer_dir" ]; then
        developer_dir="$(xcode-select -p 2>/dev/null || true)"
    fi
    case "$developer_dir" in
        *.app/Contents/Developer) ;;
        *)
            developer_dir=""
            if [ -d "/Applications/Xcode.app/Contents/Developer" ]; then
                developer_dir="/Applications/Xcode.app/Contents/Developer"
                export DEVELOPER_DIR="$developer_dir"
            fi
            ;;
    esac

    if [ -z "$developer_dir" ]; then
        cat >&2 <<'EOF'

FOUT: Xcode is niet gevonden.

De Safari-app bouwen kan alleen met de volledige Xcode (gratis, App Store);
de Command Line Tools alleen zijn niet genoeg.

  1. Installeer Xcode uit de App Store en open het één keer.
  2. Draai dit script opnieuw.

Wil je de extensie eerst proberen zonder Xcode? Draai dan
  safari/build.sh --stage-only
en laad de map in Safari als tijdelijke extensie ("Add Temporary Extension",
Safari 26 of nieuwer; de extensie verdwijnt als je Safari sluit).
EOF
        exit 1
    fi

    xcodebuild -version >/dev/null 2>&1 \
        || die "Xcode staat er wel, maar start niet. Open Xcode één keer, zodat de licentie geaccepteerd is en de onderdelen geïnstalleerd zijn, en draai dit script opnieuw."

    if xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
        CONVERTER=safari-web-extension-converter
    elif xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
        CONVERTER=safari-web-extension-packager
    else
        die "Apple's converter voor Safari-extensies zit niet in deze Xcode; werk Xcode bij"
    fi
}

# --- ondertekenen ------------------------------------------------------------

# Het team staat in het OU-veld van het "Apple Development"-certificaat. Een
# gratis Apple ID in Xcode levert dat certificaat al; een betaald
# ontwikkelaarsaccount is niet nodig.
detect_team_id() {
    security find-certificate -c "Apple Development" -p 2>/dev/null \
        | openssl x509 -noout -subject 2>/dev/null \
        | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' \
        | head -1 || true
}

require_team_id() {
    TEAM_ID="${TEAM_ID:-$(detect_team_id)}"
    if [ -z "$TEAM_ID" ]; then
        cat >&2 <<'EOF'

FOUT: geen "Apple Development"-certificaat gevonden.

Safari schakelt een niet-ondertekende extensie bij elke herstart uit. Met een
gratis certificaat blijft Cleanplaats gewoon aan staan. Eenmalig instellen:

  1. Open Xcode > Settings > Accounts.
  2. Klik op "+" en log in met je Apple ID (een gewoon Apple ID is genoeg).
  3. Kies je account > "Manage Certificates..." > "+" > "Apple Development".
  4. Draai dit script opnieuw.

Liever zonder certificaat? Dan kan het met  safari/build.sh --unsigned
maar dan moet je na elke herstart van Safari de optie voor niet-ondertekende
extensies ("Allow Unsigned Extensions", bij de ontwikkelaarsinstellingen)
opnieuw aanzetten.
EOF
        exit 1
    fi
}

lowercase() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# --- bouwen ------------------------------------------------------------------

convert() {
    info "Xcode-project maken met $CONVERTER..."
    rm -rf "$PROJECT_DIR"
    mkdir -p "$PROJECT_DIR"
    xcrun "$CONVERTER" "$STAGE" \
        --project-location "$PROJECT_DIR" \
        --app-name "$APP_NAME" \
        --bundle-identifier "$BUNDLE_ID" \
        --macos-only --copy-resources --no-open --no-prompt --force \
        || die "de converter is mislukt"

    PROJECT="$PROJECT_DIR/$APP_NAME/$APP_NAME.xcodeproj"
    [ -d "$PROJECT" ] || die "de converter heeft $PROJECT niet gemaakt"
    python3 "$HERE/stage.py" --fix-project "$PROJECT_DIR" "$BUNDLE_ID"
}

# run_xcodebuild <instellingen...>: bouwt en zet het resultaat in $BUILT_APP.
# Geslaagd of niet wordt aan het logboek afgelezen, niet aan de exit-code van
# de pijp.
run_xcodebuild() {
    rm -rf "$DERIVED"
    set +e
    xcodebuild \
        -project "$PROJECT" \
        -scheme "$SCHEME" \
        -configuration Release \
        -derivedDataPath "$DERIVED" \
        MARKETING_VERSION="$VERSION" \
        ${1+"$@"} \
        build >"$LOG" 2>&1
    set -e

    BUILT_APP="$DERIVED/Build/Products/Release/$APP_NAME.app"
    [ -d "$BUILT_APP" ] && grep -q "BUILD SUCCEEDED" "$LOG"
}

build() {
    SCHEME="$APP_NAME"
    if xcodebuild -list -project "$PROJECT" 2>/dev/null | grep -qF "$APP_NAME (macOS)"; then
        SCHEME="$APP_NAME (macOS)"
    fi

    if [ "$UNSIGNED" -eq 1 ]; then
        info "Bouwen zonder certificaat..."
        run_xcodebuild CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
            || build_failed
        return
    fi

    info "Bouwen en ondertekenen met team $TEAM_ID..."
    if run_xcodebuild -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic; then
        return
    fi

    # Automatisch ondertekenen heeft een ingelogd account in Xcode nodig. Het
    # certificaat zelf is genoeg voor een Mac-app zonder bijzondere rechten,
    # dus zonder account lukt het nog met de hand gekozen identiteit.
    info "Automatisch ondertekenen lukte niet; opnieuw met het certificaat zelf..."
    cp "$LOG" "$LOG.automatic" 2>/dev/null || true
    run_xcodebuild DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Manual "CODE_SIGN_IDENTITY=Apple Development" PROVISIONING_PROFILE_SPECIFIER= \
        || build_failed
}

build_failed() {
    echo "" >&2
    echo "De build is mislukt. De laatste 40 regels van $LOG:" >&2
    tail -40 "$LOG" >&2 || true
    die "bouwen mislukt, zie hierboven"
}

# --- installeren -------------------------------------------------------------

# Vooraf, zodat een build van een paar minuten niet pas bij het kopiëren strandt.
check_install_dir() {
    { [ -d "$INSTALL_DIR" ] && [ -w "$INSTALL_DIR" ]; } || die "kan niet schrijven in $INSTALL_DIR (zet INSTALL_DIR op een eigen map, bijvoorbeeld ~/Applications)"

    # Alleen een app vervangen die van deze build komt. Staat er ooit een
    # Cleanplaats uit de App Store, dan blijft die staan.
    local target="$INSTALL_DIR/$APP_NAME.app"
    if [ -d "$target" ]; then
        local existing
        existing="$(defaults read "$target/Contents/Info" CFBundleIdentifier 2>/dev/null || true)"
        case "$existing" in
            "$BUNDLE_ID"|local.cleanplaats.*) ;;
            *) die "$target bestaat al en is een andere app (${existing:-onbekend}). Verplaats die eerst, of kies een andere APP_NAME of INSTALL_DIR." ;;
        esac
    fi
}

install_app() {
    info "Handtekening controleren..."
    codesign --verify --deep --strict "$BUILT_APP" || die "de handtekening klopt niet; er is niets geïnstalleerd"

    local target="$INSTALL_DIR/$APP_NAME.app"
    local staged="$INSTALL_DIR/.$APP_NAME.new.app"

    info "Installeren in $INSTALL_DIR..."
    # Eerst kopiëren, dan wisselen: mislukt het kopiëren, dan staat de oude app er nog.
    rm -rf "$staged"
    ditto "$BUILT_APP" "$staged" || { rm -rf "$staged"; die "kopiëren naar $INSTALL_DIR is mislukt"; }
    rm -rf "$target"
    mv "$staged" "$target" || die "de app kon niet op zijn plek gezet worden"

    local lsregister="/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister"
    if [ -x "$lsregister" ]; then
        "$lsregister" -f -R -trusted "$target" >/dev/null 2>&1 || true
    fi

    rm -rf "$DERIVED"
    INSTALLED_APP="$target"
}

finish() {
    cat <<EOF

Klaar: Cleanplaats $VERSION staat in $INSTALLED_APP.

Eerste keer:
  1. Safari > Instellingen > Extensies: vink "Cleanplaats" aan.
  2. Open marktplaats.nl, klik op het Cleanplaats-icoon in de werkbalk en geef
     de extensie altijd toegang tot deze website (ook op 2dehands.be en
     2ememain.be als je die gebruikt).
  3. Ververs de pagina.
EOF
    if [ "$UNSIGNED" -eq 1 ]; then
        cat <<'EOF'

Deze build is niet ondertekend. Zet na elke herstart van Safari opnieuw de
optie voor niet-ondertekende extensies aan ("Allow Unsigned Extensions", bij de
ontwikkelaarsinstellingen van Safari).
EOF
    fi
    echo ""
    echo "Bijwerken na een nieuwe versie van Cleanplaats:  safari/build.sh --update"

    if [ "$OPEN_AFTER" -eq 1 ]; then
        # De app één keer openen meldt de extensie bij Safari aan.
        open "$INSTALLED_APP" || true
    fi
}

# --- hoofdlijn ---------------------------------------------------------------

if [ "$UPDATE" -eq 1 ]; then
    update_checkout
fi

stage_extension

if [ "$STAGE_ONLY" -eq 1 ]; then
    cat <<EOF

De extensiemap staat klaar. Proberen zonder Xcode (Safari 26 of nieuwer):
  1. Safari > Instellingen > Geavanceerd: zet de functies voor webontwikkelaars
     aan ("Show features for web developers").
  2. Kies bij de ontwikkelaarsinstellingen (tabblad Ontwikkelaar, of het menu
     Ontwikkel) "Add Temporary Extension..." en selecteer de map
       $STAGE
     Vraagt Safari erom, zet dan ook "Allow Unsigned Extensions" aan.
De extensie verdwijnt als je Safari sluit; voor een blijvende installatie draai
je safari/build.sh zonder opties.
EOF
    exit 0
fi

require_xcode

if [ "$UNSIGNED" -eq 1 ]; then
    BUNDLE_ID="${BUNDLE_ID:-local.cleanplaats.unsigned}"
else
    require_team_id
    # Het team in de id houdt hem uniek: twee mensen die dit bouwen krijgen
    # niet dezelfde, en een ondertekende en een niet-ondertekende build zitten
    # elkaar in Safari niet in de weg.
    BUNDLE_ID="${BUNDLE_ID:-local.cleanplaats.t$(lowercase "$TEAM_ID")}"
fi

info "Versie:    $VERSION"
info "Bundle-id: $BUNDLE_ID"

check_install_dir
convert
build
install_app
finish
