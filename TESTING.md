# Testing Guide for Simple-Tiling

## Overview

Simple-Tiling uses a **pragmatic testing approach** tailored to GNOME Shell extension development:

1. **Sandbox Testing**: Nested GNOME Shell via toolbox for isolated, repeatable testing
2. **Static Analysis**: ESLint + TypeScript strict mode catch errors at compile-time
3. **Type Safety as Testing**: Strict TypeScript settings prevent entire classes of runtime errors
4. **Manual Testing Protocols**: Comprehensive checklist covering critical functionality

**Why no traditional unit tests?**
- GNOME Shell extensions run in the GJS runtime (not Node.js)
- Cannot mock native GNOME APIs (`Meta.Window`, `Meta.Workspace`, etc.) outside GNOME Shell
- Industry standard for GNOME extensions: ESLint + TypeScript + manual testing
- MosaicWM and most production extensions follow this pattern

## Static Analysis

### Running Checks

```bash
# TypeScript compilation (strictest settings enabled)
npm run build:ts

# ESLint static analysis
npm run lint

# Auto-fix ESLint issues where possible
npm run lint:fix
```

### TypeScript Strict Mode

Our `tsconfig.json` enables the strictest possible type checking:

- ✅ `strict: true` - All strict mode family checks enabled
- ✅ `noImplicitAny: true` - No implicit `any` types allowed
- ✅ `strictNullChecks: true` - `null` and `undefined` handled explicitly
- ✅ `noUnusedLocals: true` - Catch unused variables
- ✅ `noUnusedParameters: true` - Catch unused function parameters
- ✅ `noImplicitReturns: true` - All code paths must return a value
- ✅ `noUncheckedIndexedAccess: true` - Array/object access returns `T | undefined`

**These settings prevent:**
- Type confusion bugs
- Null reference errors
- Unhandled undefined values
- Dead code accumulation
- Missing return statements

## Sandbox Testing with Toolbox

The primary way to test the extension is in a **nested GNOME Shell session** running inside a Fedora toolbox container. This gives you an isolated GNOME Shell instance that doesn't affect your host session — you can safely crash it, test enable/disable cycles, and iterate without logging out.

### One-Time Setup

Create the development toolbox (Fedora 42 with GNOME Shell + glib2-devel):

```bash
./scripts/create-toolbox.sh
```

This creates a toolbox named `gnome-shell-devel`. You only need to run this once (or again if you want to recreate it with a newer image).

### Development Workflow

```bash
# 1. Build and install to the sandbox environment (.dev-data/)
./scripts/install.sh --dev

# 2. Launch a nested GNOME Shell with the extension auto-enabled
./scripts/run-gnome-shell.sh
```

The install script uses a `.dev-data/` directory as the `XDG_DATA_HOME` and `XDG_CONFIG_HOME` for the nested shell, so all extension data, gsettings, and dconf state are local to the project and isolated from your host.

### Useful Options

```bash
# Run with two monitors
./scripts/run-gnome-shell.sh --multi-monitor

# Run with debug logging enabled
./scripts/run-gnome-shell.sh --verbose

# Reinstall after changes (uninstall + build + install)
./scripts/install.sh --dev --reinstall

# Clean up the dev environment
./scripts/install.sh --clean

# Install to host system instead (for final validation)
./scripts/install.sh --prod
```

### Viewing Logs in the Sandbox

Since the nested shell runs inside `dbus-run-session`, logs go to the toolbox's journal. From the host, you can watch the nested shell's stderr output directly in the terminal where you launched `run-gnome-shell.sh`.

## Manual Testing Protocol

### Pre-Release Testing Checklist

Before each release, manually verify the following scenarios:

#### 1. Extension Lifecycle

- [ ] **Enable Extension**
  - Extension enables without errors in logs
  - Quick Settings toggle appears and shows "ON"
  - Existing windows tile immediately (if enabled)

- [ ] **Disable Extension**
  - Extension disables cleanly (check logs for GLib.source_remove errors)
  - All timeouts cleared (no lingering timers)
  - All signals disconnected (no zombie connections)
  - Windows return to floating state

- [ ] **Re-enable Extension**
  - Extension re-enables successfully
  - Full functionality restored
  - No duplicate signal connections

#### 2. Basic Tiling Functionality

- [ ] **Open Multiple Windows (5+)**
  - Windows automatically tile in primary-stack layout
  - First window is primary (left half)
  - Remaining windows stack (right half)
  - Gaps applied correctly (inner, outer-horizontal, outer-vertical)

- [ ] **Close Windows**
  - Remaining windows retile to fill space
  - No gaps or overlapping windows

- [ ] **Minimize/Unminimize Windows**
  - Minimized windows removed from layout
  - Remaining windows retile
  - Unminimizing restores window to layout

- [ ] **Maximize/Unmaximize Windows**
  - Tiling disabled when maximized window present
  - Unmaximizing triggers retiling

#### 3. Workspace Management

- [ ] **Switch Workspaces**
  - Each workspace maintains independent window layout
  - Switching between workspaces shows correct tiled windows
  - No cross-workspace interference

- [ ] **Move Window Between Workspaces**
  - Window removed from source workspace layout
  - Window added to destination workspace layout
  - Both workspaces retile correctly

#### 4. Window Exception Handling

- [ ] **Exception Window Behavior**
  - Exception windows center on screen (if center-exceptions enabled)
  - Exception windows stay on top (if exceptions-always-on-top enabled)
  - Exception windows do not participate in tiling
  - Closing exception window does not trigger retiling

- [ ] **Reload Exceptions**
  - Add new window class to exception list in settings
  - Exception takes effect immediately (no restart needed)
  - New exception class is honored

#### 5. Drag-and-Drop Reordering

- [ ] **Swap Primary Window**
  - Drag window onto primary position
  - Windows swap positions correctly
  - Layout updates immediately

- [ ] **Reorder Stack Windows**
  - Drag window within stack area
  - Stack order updates correctly

#### 6. Settings Changes

- [ ] **Toggle Tiling On/Off**
  - Quick Settings toggle works
  - Windows float when disabled
  - Windows tile when re-enabled

- [ ] **Change Gap Settings**
  - Update inner-gap value
  - Windows retile with new gap size

- [ ] **Change Layout Method**
  - Switch between Primary-Stack and Fibonacci
  - Windows retile with new layout algorithm

#### 7. Edge Cases

- [ ] **Single Window**
  - Single window maximizes to work area (respecting gaps)

- [ ] **Rapid Window Open/Close**
  - Open and close windows quickly
  - No duplicate windows in layout
  - No stale window references
  - No crashes or hangs

- [ ] **Window Ready Timing**
  - Open application that delays window geometry (e.g., terminal)
  - Window waits for valid geometry before tiling
  - No positioning glitches

- [ ] **Multi-Monitor Setup** (if applicable)
  - Each monitor tiles independently
  - Windows stay on correct monitor

#### 8. Performance

- [ ] **Tiling Lag**
  - Open 10+ windows
  - Windows tile smoothly without visible lag
  - No excessive CPU usage

- [ ] **Memory Leaks**
  - Enable extension, open/close 20+ windows, disable extension
  - Check GNOME Shell memory usage (should not grow significantly)
  - Verify WeakMaps allow garbage collection

#### 9. Error Handling

- [ ] **Invalid Window Detection**
  - Open window, close it, trigger retiling
  - No errors about null/undefined windows in logs
  - Stale window references filtered out

- [ ] **Null WorkspaceManager**
  - Rapidly enable/disable extension
  - No crashes from accessing null `_workspaceManager`

## Logging and Debugging

### View Extension Logs

```bash
# Real-time log viewing
journalctl -f -o cat /usr/bin/gnome-shell

# Filter for Simple-Tiling only
journalctl -f -o cat /usr/bin/gnome-shell | grep SimpleTiling
```

### Enable Debug Logging

1. Open GNOME Extensions app
2. Find Simple-Tiling
3. Click Settings ⚙️
4. Enable "Debug Logging"
5. Logs will show detailed information about:
   - Window lifecycle events
   - Signal connections/disconnections
   - Timeout additions/removals
   - Workspace changes
   - Tiling calculations

### Common Error Patterns

**Symptom**: Windows not tiling
- Check: Is extension enabled? (`gnome-extensions info simple-tiling@lucasroesler`)
- Check: Is tiling toggled on in Quick Settings?
- Check: Are windows in exception list?
- Check: Are there maximized windows on workspace?

**Symptom**: Extension won't enable
- Check logs for TypeScript compilation errors
- Run: `npm run build:ts` to see compilation errors
- Check for missing dependencies: `npm install`

**Symptom**: Extension crashes on disable
- Check logs for signal disconnection errors
- Look for GLib.source_remove warnings
- Verify all timeouts in TimeoutRegistry

## Code Review Guidelines

### When to Request Review

Request a code review when:
- Adding new managers or major architectural changes
- Modifying signal management or timeout handling
- Changing window state tracking logic
- Refactoring critical tiling algorithms

### Review Focus Areas

1. **Type Safety**
   - No `any` types (use `unknown` and narrow)
   - No unsafe type assertions (`as` casts)
   - Explicit return types on public methods
   - Null safety (`Type | null` not `Type?`)

2. **Resource Cleanup**
   - All signals disconnected in `disable()`
   - All timeouts cleared in `disable()`
   - WeakMaps used for window state (enables GC)
   - No memory leaks from circular references

3. **Error Handling**
   - Null checks before accessing native objects
   - Validity checks on windows before operations
   - Try-catch around signal disconnection
   - Defensive coding for stale references

4. **Simplicity**
   - Single responsibility per manager
   - Clear dependency injection
   - No clever tricks or premature optimization
   - Readable code over concise code

## Testing Checklist Summary

Before committing any changes:

- [ ] `npm run build:ts` succeeds with zero errors
- [ ] `npm run lint` passes with zero errors
- [ ] Manually test at least 3 critical scenarios from protocol above
- [ ] Check logs for errors, warnings, or GLib issues
- [ ] Verify extension can be cleanly disabled and re-enabled

Before releasing:

- [ ] Complete full manual testing protocol in the sandbox (`./scripts/run-gnome-shell.sh`)
- [ ] Test multi-monitor layout (`./scripts/run-gnome-shell.sh --multi-monitor`)
- [ ] Verify extension works after GNOME Shell restart
- [ ] Final validation on host system (`./scripts/install.sh --prod`)

## Future Testing Improvements

Potential enhancements (not current priorities):

- **Performance Benchmarking**: Automated timing of layout calculations
- **Memory Profiling**: Track heap usage over time in the nested shell
- **Snapshot Testing**: Compare layout results for regression detection
