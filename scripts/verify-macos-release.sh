#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Verifies macOS release artifacts the way Gatekeeper sees them: a Developer ID
# signature from the expected team with a secure timestamp, hardened runtime,
# no entitlements, a universal executable, and a stapled notarization ticket.
# Apps are checked inside each DMG and .app.tar.gz, then launched in
# --mcp-stdio mode to prove the signed binary still runs under hardened
# runtime. Any failure exits non-zero.
#
# Usage: verify-macos-release.sh --team <TEAMID> <file.dmg|file.app.tar.gz|file.app>...

set -euo pipefail

usage="usage: verify-macos-release.sh --team <TEAMID> <file.dmg|file.app.tar.gz|file.app>..."
[[ "${1:-}" == "--team" && -n "${2:-}" && $# -ge 3 ]] || { echo "$usage" >&2; exit 2; }
team=$2
shift 2
[[ "$team" =~ ^[A-Z0-9]{10}$ ]] || { echo "Team ID must be 10 uppercase letters or digits." >&2; exit 2; }

fail() {
  echo "::error::$*"
  exit 1
}

# Developer ID Application certificate (intermediate and leaf marker OIDs)
# issued to the expected team, chained to Apple's root.
requirement="anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"$team\""

work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/macos-verify.XXXXXX")
mounts=()
cleanup() {
  local mount
  for mount in ${mounts[@]+"${mounts[@]}"}; do
    hdiutil detach "$mount" -quiet -force || true
  done
  rm -rf "$work"
}
trap cleanup EXIT

if [[ "$(spctl --status 2>&1)" == *enabled* ]]; then
  gatekeeper=1
else
  gatekeeper=0
  echo "::warning::Gatekeeper assessments are disabled on this machine; skipping spctl checks."
fi

check_signature() {
  local path=$1 details
  codesign --verify --strict -R "=$requirement" "$path" \
    || fail "$path is not signed by a Developer ID Application certificate for team $team."
  codesign --verify --check-notarization -R "=notarized" "$path" 2>/dev/null \
    || fail "$path is not notarized."
  xcrun stapler validate -q "$path" || fail "$path has no valid stapled notarization ticket."
  details=$(codesign --display --verbose=2 "$path" 2>&1)
  grep -q "^Timestamp=" <<< "$details" || fail "$path has no secure timestamp."
}

assess() {
  local path=$1 type=$2 assessment
  [[ "$gatekeeper" -eq 1 ]] || return 0
  if [[ "$type" == open ]]; then
    assessment=$(spctl --assess --type open --context context:primary-signature --verbose=2 "$path" 2>&1) \
      || fail "Gatekeeper rejected $path: $assessment"
  else
    assessment=$(spctl --assess --type execute --verbose=2 "$path" 2>&1) \
      || fail "Gatekeeper rejected $path: $assessment"
  fi
  grep -q "source=Notarized Developer ID" <<< "$assessment" \
    || fail "Gatekeeper did not accept $path as notarized Developer ID software: $assessment"
}

# The editor must refuse a malformed MCP invocation and report a missing token
# without starting the UI. Both paths run the signed binary end to end.
smoke_test() {
  local label=$1 status output home
  shift
  home=$(mktemp -d "$work/home.XXXXXX")

  set +e
  output=$(HOME="$home" "$@" --mcp-stdio extra 2>&1 < /dev/null)
  status=$?
  set -e
  [[ "$status" -eq 2 && "$output" == *"Usage: scratchpad --mcp-stdio"* ]] \
    || fail "$label: --mcp-stdio usage check exited $status: $output"

  set +e
  output=$(HOME="$home" "$@" --mcp-stdio 2>&1 < /dev/null)
  status=$?
  set -e
  [[ "$status" -eq 1 && "$output" == *"enable agent access"* ]] \
    || fail "$label: --mcp-stdio without a token exited $status: $output"
  echo "  $label runs under hardened runtime (--mcp-stdio)"
}

verify_app() {
  local app=$1 executable binary details entitlements archs
  echo "Checking $app"
  [[ -f "$app/Contents/Info.plist" ]] || fail "$app is not an application bundle."

  codesign --verify --deep --strict "$app" || fail "$app has an invalid signature."
  check_signature "$app"
  assess "$app" execute

  executable=$(plutil -extract CFBundleExecutable raw -o - "$app/Contents/Info.plist")
  binary="$app/Contents/MacOS/$executable"
  for file in "$app"/Contents/MacOS/*; do
    details=$(codesign --display --verbose=2 "$file" 2>&1)
    grep -Eq "flags=0x[0-9a-f]+\([^)]*runtime" <<< "$details" || fail "$file is not signed with the hardened runtime."
    grep -q "^TeamIdentifier=$team$" <<< "$details" || fail "$file is not signed by team $team."
  done

  # Scratchpad needs no entitlements; any that appear must be reviewed first.
  entitlements=$(codesign --display --entitlements - --xml "$app" 2>/dev/null || true)
  if grep -q "<key>" <<< "$entitlements"; then
    fail "$app has unexpected entitlements: $entitlements"
  fi

  archs=$(lipo -archs "$binary")
  [[ " $archs " == *" arm64 "* && " $archs " == *" x86_64 "* ]] \
    || fail "$binary is not universal (architectures: $archs)."

  smoke_test "$(uname -m) slice" "$binary"
  if arch -x86_64 /usr/bin/true 2>/dev/null; then
    [[ "$(uname -m)" == x86_64 ]] || smoke_test "x86_64 slice (Rosetta)" arch -x86_64 "$binary"
  else
    echo "  Rosetta is not installed; skipping the x86_64 launch check."
  fi
  echo "  OK: signed by team $team, notarized, stapled, hardened runtime, no entitlements, $archs"
}

# Sets $app to the single application bundle at the top of a directory.
find_app() {
  local dir=$1 apps
  apps=$(find "$dir" -maxdepth 1 -name "*.app" -type d)
  [[ -n "$apps" && $(wc -l <<< "$apps") -eq 1 ]] || fail "Expected one .app in $dir, found: ${apps:-none}"
  app=$apps
}

for artifact in "$@"; do
  [[ -e "$artifact" ]] || fail "$artifact does not exist."
  case "$artifact" in
    *.dmg)
      echo "Checking $artifact"
      check_signature "$artifact"
      assess "$artifact" open
      mount=$(mktemp -d "$work/mount.XXXXXX")
      hdiutil attach "$artifact" -nobrowse -readonly -noautoopen -mountpoint "$mount" -quiet \
        || fail "Could not mount $artifact."
      mounts+=("$mount")
      echo "  OK: disk image signed by team $team, notarized, stapled"
      find_app "$mount"
      verify_app "$app"
      ;;
    *.app.tar.gz)
      extract=$(mktemp -d "$work/extract.XXXXXX")
      tar -xzf "$artifact" -C "$extract" || fail "Could not extract $artifact."
      find_app "$extract"
      verify_app "$app"
      ;;
    *.app)
      verify_app "${artifact%/}"
      ;;
    *)
      fail "Unsupported artifact $artifact."
      ;;
  esac
done

echo "All macOS artifacts verified."
