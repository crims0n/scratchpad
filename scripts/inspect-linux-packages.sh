#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
architecture=${1:?usage: inspect-linux-packages.sh ARCH ASSETS BUILT BINARY_NAME OUTPUT_DIR}
assets=${2:?assets directory is required}
built=${3:?built application is required}
binary=${4:?binary name is required}
inspection=${5:?inspection directory is required}
scripts=$(cd "$(dirname "$0")" && pwd)
case "$architecture" in
  x64) expected_deb=amd64 ;;
  arm64) expected_deb=arm64 ;;
  *) echo 'Expected x64 or arm64' >&2; exit 2 ;;
esac
mapfile -t appimages < <(find "$assets" -maxdepth 2 -type f -name '*.AppImage')
mapfile -t debs < <(find "$assets" -maxdepth 2 -type f -name '*.deb')
[[ ${#appimages[@]} -eq 1 && ${#debs[@]} -eq 1 ]] || { echo 'Expected one AppImage and DEB' >&2; exit 1; }
[[ "$(dpkg-deb --field "${debs[0]}" Architecture)" == "$expected_deb" ]] || { echo 'Wrong DEB architecture' >&2; exit 1; }
# An absolute path is needed after changing to the extraction directory.
appimage=$(realpath "${appimages[0]}")
mkdir "$inspection"
mkdir "$inspection/deb" "$inspection/appimage"
dpkg-deb --extract "${debs[0]}" "$inspection/deb"
chmod +x "$appimage"
(cd "$inspection/appimage" && "$appimage" --appimage-extract)
node "$scripts/verify-linux-release.mjs" "$architecture" "$built" "$binary" \
  "$inspection/deb" "$inspection/appimage/squashfs-root"
