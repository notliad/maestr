#!/bin/sh
set -eu

repo="${MAESTR_REPO:-notliad/maestr}"
bin_dir="${MAESTR_BIN_DIR:-${HOME}/.local/bin}"
api="https://api.github.com/repos/${repo}/releases/latest"

command -v curl >/dev/null 2>&1 || { echo "Maestr requires curl." >&2; exit 1; }

os=$(uname -s)
[ "$os" = "Linux" ] || { echo "This installer currently supports Linux only. Use a release installer for $os." >&2; exit 1; }

arch=$(uname -m)
case "$arch" in
  x86_64|amd64) suffix="amd64" ;;
  aarch64|arm64) suffix="aarch64" ;;
  *) echo "Unsupported Linux architecture: $arch" >&2; exit 1 ;;
esac

release=$(curl -fsSL "$api")
asset=$(printf '%s\n' "$release" | sed -n 's/.*"browser_download_url": "\([^"]*\.AppImage\)".*/\1/p' | grep "_${suffix}\.AppImage$" | head -n 1)

if [ -z "$asset" ]; then
  echo "No Maestr AppImage was found for $suffix in the latest release." >&2
  echo "Check the releases at https://github.com/${repo}/releases" >&2
  exit 1
fi

mkdir -p "$bin_dir"
tmp=$(mktemp "${TMPDIR:-/tmp}/maestr.XXXXXX")
trap 'rm -f "$tmp"' EXIT INT TERM

echo "Downloading Maestr..."
curl -fL --progress-bar "$asset" -o "$tmp"
chmod 755 "$tmp"
mv "$tmp" "$bin_dir/maestr"

echo "Maestr installed at $bin_dir/maestr"
case ":${PATH}:" in
  *:"$bin_dir":*) ;;
  *) echo "Add $bin_dir to PATH to run 'maestr' from any terminal." ;;
esac
