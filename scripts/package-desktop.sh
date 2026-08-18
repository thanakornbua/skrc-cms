#!/usr/bin/env bash
# Builds the Windows console and writes the portable package as a single zip.
#
# Run from WSL or Linux; no Windows toolchain, no Mono, no Wine. The output is
# the unpacked-folder build, which is what the operator laptop runs — the
# Squirrel installer needs a Windows runner (.github/workflows/windows-desktop.yml).
#
# Everything the app needs is inside the zip except competition-day.env, which
# lives in %APPDATA% on the laptop and is deliberately never packaged.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="${SKRC_BUILD_DIR:-$HOME/skrc-builds}"
zip_path="$out_dir/SKRC-Competition-Day-win32-x64.zip"
package_dir="$root/desktop/out/SKRC Competition Day-win32-x64"

echo "==> Building and packaging"
npm run package:win --prefix "$root/desktop"

[ -d "$package_dir" ] || { echo "Package directory missing: $package_dir" >&2; exit 1; }

mkdir -p "$out_dir"
echo "==> Zipping to $zip_path"
python3 - "$package_dir" "$zip_path" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for root, _dirs, files in os.walk(src):
        for name in files:
            path = os.path.join(root, name)
            archive.write(path, os.path.relpath(path, src))
            count += 1
print(f"    {count} files, {os.path.getsize(out) // 1024 // 1024} MB")
PY

# The commit is the only reliable way to tell two 144MB zips apart on the
# laptop, where there is no repository to ask.
commit="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo unknown)"
printf 'commit %s\nbuilt   %s\n' "$commit" "$(date -Iseconds)" > "$out_dir/BUILD.txt"

echo "==> Done: $zip_path (commit $commit)"
if command -v wslpath >/dev/null 2>&1; then
  echo "    On Windows, to install it:"
  echo "    powershell -ExecutionPolicy Bypass -File $(wslpath -w "$root/scripts/update-desktop.ps1")"
fi
