#!/bin/bash
# Install the extension to the local GNOME Shell extensions directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
EXT_UUID="simple-tiling@lucasroesler"

# Production install location
PROD_EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"

# Dev install location (local to project)
DEV_DATA_DIR="$PROJECT_DIR/.dev-data"
DEV_EXT_DIR="$DEV_DATA_DIR/gnome-shell/extensions/$EXT_UUID"

usage() {
  cat <<-EOF
	Usage: $(basename $0) [OPTION…]

	Build and install the Simple-Tiling extension

	Options:
	  -d, --dev               Install to local .dev-data/ for nested shell testing
	  -p, --prod              Install to ~/.local/share (default, affects host system)
	  -u, --uninstall         Uninstall the extension
	  -c, --clean             Remove .dev-data/ directory (dev environment cleanup)
	  -r, --reinstall         Uninstall then reinstall
	  -h, --help              Display this help

	Examples:
	  $(basename $0) --dev         Build and install for nested shell testing
	  $(basename $0) --prod        Build and install to host system
	  $(basename $0) --clean       Remove dev environment

	EOF
}

build() {
  echo "Building extension..."
  cd "$PROJECT_DIR"
  npm run build
}

install_ext() {
  local target_dir="$1"
  local install_type="$2"

  echo "Installing to $target_dir..."
  mkdir -p "$target_dir"
  cp -r "$PROJECT_DIR/$EXT_UUID/"* "$target_dir/"
  echo "Extension installed successfully! ($install_type)"

  if [[ "$install_type" == "dev" ]]; then
    echo ""
    echo "To test in nested shell, run:"
    echo "  ./scripts/run-gnome-shell.sh"
  else
    echo ""
    echo "To enable, either:"
    echo "  1. Restart GNOME Shell (Alt+F2 → 'r' on X11, or log out/in on Wayland)"
    echo "  2. Run: gnome-extensions enable $EXT_UUID"
  fi
}

uninstall_ext() {
  local target_dir="$1"
  if [[ -d "$target_dir" ]]; then
    echo "Uninstalling from $target_dir..."
    rm -rf "$target_dir"
    echo "Extension uninstalled."
  else
    echo "Extension not installed at $target_dir"
  fi
}

clean_dev() {
  if [[ -d "$DEV_DATA_DIR" ]]; then
    echo "Removing dev environment at $DEV_DATA_DIR..."
    rm -rf "$DEV_DATA_DIR"
    echo "Dev environment cleaned."
  else
    echo "No dev environment found."
  fi
}

# Default to dev install
MODE="dev"
ACTION="install"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dev)
      MODE="dev"
      shift
      ;;
    -p|--prod)
      MODE="prod"
      shift
      ;;
    -u|--uninstall)
      ACTION="uninstall"
      shift
      ;;
    -c|--clean)
      ACTION="clean"
      shift
      ;;
    -r|--reinstall)
      ACTION="reinstall"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

# Determine target directory
if [[ "$MODE" == "dev" ]]; then
  TARGET_DIR="$DEV_EXT_DIR"
else
  TARGET_DIR="$PROD_EXT_DIR"
fi

# Execute action
case "$ACTION" in
  install)
    build
    install_ext "$TARGET_DIR" "$MODE"
    ;;
  uninstall)
    uninstall_ext "$TARGET_DIR"
    ;;
  reinstall)
    uninstall_ext "$TARGET_DIR"
    build
    install_ext "$TARGET_DIR" "$MODE"
    ;;
  clean)
    clean_dev
    ;;
esac
