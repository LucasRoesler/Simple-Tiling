#!/bin/bash
# Adapted from: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/tools/toolbox/run-gnome-shell.sh
# vi: sw=2 ts=4

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEV_DATA_DIR="$PROJECT_DIR/.dev-data"

DEFAULT_TOOLBOX=gnome-shell-devel
CONFIG_FILE=${XDG_CONFIG_HOME:-$HOME/.config}/gnome-shell-toolbox-tools.conf

usage() {
  cat <<-EOF
	Usage: $(basename $0) [OPTION…]

	Run gnome-shell from a toolbox

	Options:
	  -t, --toolbox=TOOLBOX   Use TOOLBOX instead of the default "$DEFAULT_TOOLBOX"

	  --classic               Run in Classic mode
	  --greeter               Run (simulated) login screen

	  -2, --multi-monitor     Run with two monitors
	  -0, --headless          Run headless

	  --rtl                   Force right-to-left layout
	  --locale=LOCALE         Use specified LOCALE

	  --debug                 Run in gdb
	  -v, --verbose           Enable debug logging

	  --unsafe-mode           Do no restrict D-Bus APIs
	  --force-animations      Force animations to be enabled

	  --version               Print version
	  -h, --help              Display this help

	EOF
}

die() {
  echo "$@" >&2
  exit 1
}

find_locale() {
  locale -a | sed -e "/^$1/!d" -e '/\.utf8$/I!d' | head -n 1
}

should_run_nested() {
  [[ "$XDG_SESSION_TYPE" != "tty" ]] && [[ ! "$HEADLESS" ]]
}

has_devkit() {
  toolbox --container $TOOLBOX run gnome-shell --help | grep -q -- --devkit
}

has_nested() {
  toolbox --container $TOOLBOX run gnome-shell --help | grep -q -- --nested
}

# load defaults
if [[ -f $CONFIG_FILE ]]; then
  . $CONFIG_FILE
fi
TOOLBOX=${DEFAULT_TOOLBOX:-gnome-shell-devel}

# Ensure dev data directory exists
mkdir -p "$DEV_DATA_DIR/dconf"

EXT_UUID="simple-tiling@lucasroesler"

# Use project-local .dev-data/ for extensions AND config (doesn't affect host system)
SHELL_ENV=(
  XDG_CURRENT_DESKTOP=GNOME
  XDG_DATA_HOME="$DEV_DATA_DIR"
  XDG_CONFIG_HOME="$DEV_DATA_DIR"
)
SHELL_ARGS=()

# Some host OSes (like NixOS) have a weird $XDG_DATA_DIRS environment variable
# that breaks GSettings schemas. Make sure it is set to something sensible.
if [[ ! :$XDG_DATA_DIRS: =~ :/usr/share/?: ]]
then
  SHELL_ENV+=(XDG_DATA_DIRS=$XDG_DATA_DIRS:/usr/share/)
fi

TEMP=$(getopt \
 --name $(basename $0) \
 --options '20t:vh' \
 --longoptions 'toolbox:' \
 --longoptions 'classic' \
 --longoptions 'greeter' \
 --longoptions 'multi-monitor' \
 --longoptions 'headless' \
 --longoptions 'rtl' \
 --longoptions 'locale:' \
 --longoptions 'debug' \
 --longoptions 'verbose' \
 --longoptions 'unsafe-mode' \
 --longoptions 'force-animations' \
 --longoptions 'version' \
 --longoptions 'help' \
 -- "$@") || die "Run $(basename $0) --help to see available options"

eval set -- "$TEMP"
unset TEMP

while true; do
  case $1 in
    -t|--toolbox)
      TOOLBOX=$2
      shift 2
    ;;

    --classic)
      SHELL_ENV+=(XDG_CURRENT_DESKTOP=GNOME-Classic:GNOME)
      SHELL_ARGS+=(--mode=classic)
      shift
    ;;

    --greeter)
      SHELL_ENV+=(GDM_GREETER_TEST=1)
      SHELL_ARGS+=(--mode=gdm)
      shift
    ;;

    -2|--multi-monitor)
      SHELL_ENV+=(MUTTER_DEBUG_NUM_DUMMY_MONITORS=2)
      shift
    ;;

    -0|--headless)
      HEADLESS=1
      SHELL_ARGS+=(--headless)
      shift
    ;;

    --rtl)
      SHELL_ENV+=(CLUTTER_TEXT_DIRECTION=rtl)
      shift
    ;;

    --locale)
      SHELL_ENV+=(LANG=$(find_locale $2))
      shift 2
    ;;

    --debug)
      GDB="gdb --args"
      shift
    ;;

    -v|--verbose)
      SHELL_ENV+=(
        G_MESSAGES_DEBUG="GNOME Shell"
        SHELL_DEBUG=backtrace-warnings
      )
      shift
    ;;

    --unsafe-mode|--force-animations|--version)
      SHELL_ARGS+=($1)
      shift
    ;;

    -h|--help)
      usage
      exit 0
    ;;

    --)
      shift
      break
    ;;
  esac
done

if should_run_nested; then
  if has_devkit; then
    SHELL_ARGS+=( --devkit )
  elif has_nested; then
    SHELL_ARGS+=( --nested )
  else
    die Mutter has to be built with devkit or x11 support
  fi
else
  SHELL_ARGS+=( --wayland )
fi

# Enable extension and run gnome-shell within the same dbus session
# We use a bash wrapper to first enable the extension before starting the shell
ENABLE_CMD="gsettings set org.gnome.shell enabled-extensions \"['$EXT_UUID']\""

toolbox --container $TOOLBOX run \
  env "${SHELL_ENV[@]}" dbus-run-session bash -c "$ENABLE_CMD && $GDB gnome-shell ${SHELL_ARGS[*]}"
