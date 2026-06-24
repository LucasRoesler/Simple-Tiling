///////////////////////////////////////////////////////////////
//     Simple-Tiling – MODERN MENU (GNOME Shell 45+)         //
//     Original © 2025 Domoel – MIT                         //
//     Fork © 2025 Lucas Roesler – MIT                      //
///////////////////////////////////////////////////////////////

// ── GLOBAL IMPORTS ────────────────────────────────────────
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SimpleTilingPrefs extends ExtensionPreferences {
    override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        // ── WINDOW GAPS ────────────────────────────────────────────
        const groupGaps = new Adw.PreferencesGroup({
            title: 'Window Gaps',
            description: 'Adjust spacing between windows and screen edges.'
        });
        page.add(groupGaps);

        const rowInnerGap = new Adw.SpinRow({
            title: 'Inner Gap',
            subtitle: 'Space between tiled windows (pixels)',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1 }),
        });
        groupGaps.add(rowInnerGap);
        settings.bind('inner-gap', rowInnerGap, 'value', Gio.SettingsBindFlags.DEFAULT);

        const rowOuterH = new Adw.SpinRow({
            title: 'Outer Gap (horizontal)',
            subtitle: 'Left / right screen edges (pixels)',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1 }),
        });
        groupGaps.add(rowOuterH);
        settings.bind('outer-gap-horizontal', rowOuterH, 'value', Gio.SettingsBindFlags.DEFAULT);

        const rowOuterV = new Adw.SpinRow({
            title: 'Outer Gap (vertical)',
            subtitle: 'Top / bottom screen edges (pixels)',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1 }),
        });
        groupGaps.add(rowOuterV);
        settings.bind('outer-gap-vertical', rowOuterV, 'value', Gio.SettingsBindFlags.DEFAULT);

        // ── WINDOW BEHAVIOR ────────────────────────────────────────────
        const groupBehavior = new Adw.PreferencesGroup({ title: 'Window Behavior' });
        page.add(groupBehavior);

        const rowTilingEnabled = new Adw.ActionRow({
            title: 'Enable Tiling',
            subtitle: 'Toggle automatic tiling of windows on/off'
        });

        const tilingSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        settings.bind('tiling-enabled', tilingSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        rowTilingEnabled.add_suffix(tilingSwitch);
        rowTilingEnabled.set_activatable_widget(tilingSwitch);
        groupBehavior.add(rowTilingEnabled);

        const rowRespectMaximized = new Adw.ActionRow({
            title: 'Respect Maximized Windows',
            subtitle: 'Skip tiling when windows are maximized, otherwise force all windows to tile'
        });

        const respectMaximizedSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        settings.bind('respect-maximized-windows', respectMaximizedSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        rowRespectMaximized.add_suffix(respectMaximizedSwitch);
        rowRespectMaximized.set_activatable_widget(respectMaximizedSwitch);
        groupBehavior.add(rowRespectMaximized);

        const rowExceptionsAlwaysCenter = new Adw.ActionRow({
            title: 'Always Center Exception Windows',
            subtitle: 'Automatically center non-tiled windows on their monitor'
        });

        const exceptionsCenterSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        settings.bind('exceptions-always-center', exceptionsCenterSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        rowExceptionsAlwaysCenter.add_suffix(exceptionsCenterSwitch);
        rowExceptionsAlwaysCenter.set_activatable_widget(exceptionsCenterSwitch);
        groupBehavior.add(rowExceptionsAlwaysCenter);

        const rowExceptionsAlwaysOnTop = new Adw.ActionRow({
            title: 'Always On Top for Exception Windows',
            subtitle: 'Keep non-tiled windows above tiled windows'
        });

        const exceptionsOnTopSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        settings.bind('exceptions-always-on-top', exceptionsOnTopSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        rowExceptionsAlwaysOnTop.add_suffix(exceptionsOnTopSwitch);
        rowExceptionsAlwaysOnTop.set_activatable_widget(exceptionsOnTopSwitch);
        groupBehavior.add(rowExceptionsAlwaysOnTop);

        const rowDebugLogging = new Adw.ActionRow({
            title: 'Enable Debug Logging',
            subtitle: 'Log detailed information to GNOME Shell journal (view with: journalctl -f -o cat /usr/bin/gnome-shell)'
        });

        const debugLoggingSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        settings.bind('debug-logging', debugLoggingSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        rowDebugLogging.add_suffix(debugLoggingSwitch);
        rowDebugLogging.set_activatable_widget(debugLoggingSwitch);
        groupBehavior.add(rowDebugLogging);

        const rowNewWindow = new Adw.ComboRow({
            title: 'Open new windows as',
            subtitle: 'Whether a new window starts as Primary or Stack',
            model: new Gtk.StringList({
                strings: ['Stack Window (Default)', 'Primary Window'],
            }),
        });
        groupBehavior.add(rowNewWindow);

        const currentBehavior = settings.get_string('new-window-behavior');
        rowNewWindow.selected = currentBehavior === 'primary' ? 1 : 0;

        rowNewWindow.connect('notify::selected', () => {
            const newVal = rowNewWindow.selected === 1 ? 'primary' : 'stack';
            settings.set_string('new-window-behavior', newVal);
        });

        // ── WINDOW EXCEPTIONS ──────────────────────────────────────────
        const groupExceptions = new Adw.PreferencesGroup({
            title: 'Window Exceptions',
            description: 'Applications that should be ignored by the tiling manager and kept floating.'
        });
        page.add(groupExceptions);

        // Load exceptions from gsettings
        let defaultExceptions: string[] = [];
        let customExceptions: string[] = [];

        const loadExceptions = () => {
            defaultExceptions = settings.get_strv('default-exceptions');
            customExceptions = settings.get_strv('custom-exceptions');
        };

        const saveCustomExceptions = () => {
            settings.set_strv('custom-exceptions', customExceptions);
        };

        const getAllExceptions = (): string[] => {
            return [...new Set([...defaultExceptions, ...customExceptions])];
        };

        // Load initial exceptions
        loadExceptions();

        // Create expandable row for current exceptions
        const exceptionsExpanderRow = new Adw.ExpanderRow({
            title: 'Current Exceptions',
            subtitle: `${getAllExceptions().length} applications excluded from tiling`
        });

        const refreshButton = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Refresh list'
        });
        exceptionsExpanderRow.add_suffix(refreshButton);

        groupExceptions.add(exceptionsExpanderRow);

        // Keep track of added exception rows so we can remove them later
        let exceptionRows: Gtk.Widget[] = [];

        // Function to populate exception rows
        const populateExceptions = () => {
            // Clear all existing exception rows from the expander
            for (const row of exceptionRows) {
                exceptionsExpanderRow.remove(row);
            }
            exceptionRows = [];

            const allExceptions = getAllExceptions();

            // Update subtitle with count
            exceptionsExpanderRow.set_subtitle(`${allExceptions.length} applications excluded from tiling`);

            // Add exception rows - defaults first, then custom
            for (const exception of defaultExceptions) {
                const row = new Adw.ActionRow({
                    title: exception,
                    subtitle: 'Default (bundled with extension)'
                });

                const defaultLabel = new Gtk.Label({
                    label: 'Default',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['dim-label']
                });
                row.add_suffix(defaultLabel);

                exceptionsExpanderRow.add_row(row);
                exceptionRows.push(row);
            }

            // Add custom exceptions (removable)
            for (const exception of customExceptions) {
                // Skip if it's also in defaults (already shown above)
                if (defaultExceptions.includes(exception)) continue;

                const row = new Adw.ActionRow({
                    title: exception,
                    subtitle: 'Custom (user-added)'
                });

                const removeButton = new Gtk.Button({
                    icon_name: 'list-remove-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'destructive-action'],
                    tooltip_text: 'Remove exception'
                });
                removeButton.connect('clicked', () => {
                    const index = customExceptions.indexOf(exception);
                    if (index > -1) {
                        customExceptions.splice(index, 1);
                        saveCustomExceptions();
                        populateExceptions();
                    }
                });
                row.add_suffix(removeButton);

                exceptionsExpanderRow.add_row(row);
                exceptionRows.push(row);
            }

            // Add empty state if no exceptions
            if (allExceptions.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: 'No exceptions configured',
                    subtitle: 'Add exceptions using the field below',
                    sensitive: false
                });
                exceptionsExpanderRow.add_row(emptyRow);
                exceptionRows.push(emptyRow);
            }
        };

        refreshButton.connect('clicked', () => {
            loadExceptions();
            populateExceptions();
        });

        // Window Identification expandable row
        const windowsExpanderRow = new Adw.ExpanderRow({
            title: 'Identify Open Windows',
            subtitle: 'View and add window identifiers from currently open applications'
        });

        const scanButton = new Gtk.Button({
            label: 'Scan Windows',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat']
        });
        windowsExpanderRow.add_suffix(scanButton);

        groupExceptions.add(windowsExpanderRow);

        // Keep track of added window rows so we can remove them later
        let windowRows: Gtk.Widget[] = [];

        // Function to populate window list
        const populateWindowList = () => {
            // Clear existing rows
            for (const row of windowRows) {
                windowsExpanderRow.remove(row);
            }
            windowRows = [];

            // Try to get window information via D-Bus directly
            try {
                const result = Gio.DBus.session.call_sync(
                    'org.gnome.Shell',
                    '/org/gnome/Shell/Extensions/SimpleTiling',
                    'org.gnome.Shell.Extensions.SimpleTiling',
                    'GetWindowList',
                    null,
                    new GLib.VariantType('(s)'),
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null
                );

                const [windowsJson] = result.deep_unpack() as [string];
                const windows = JSON.parse(windowsJson);

                if (windows.length === 0) {
                    const emptyRow = new Adw.ActionRow({
                        title: 'No windows detected',
                        subtitle: 'Open some applications and scan again',
                        sensitive: false
                    });
                    windowsExpanderRow.add_row(emptyRow);
                    windowRows.push(emptyRow);
                } else {
                    // Add a row for each window
                    const addedIdentifiers = new Set();
                    const allExceptions = getAllExceptions().map(e => e.toLowerCase());
                    for (const win of windows) {
                        // Create unique identifier priority: wmClass > appId
                        const identifier = (win.wmClass || win.appId || '').toLowerCase();

                        // Skip if already added or empty
                        if (!identifier || addedIdentifiers.has(identifier)) continue;
                        addedIdentifiers.add(identifier);

                        const row = new Adw.ActionRow({
                            title: win.title,
                            subtitle: `ID: ${identifier}`
                        });

                        // Check if already in exceptions (case-insensitive)
                        const isException = allExceptions.includes(identifier);

                        if (!isException) {
                            const addButton = new Gtk.Button({
                                label: 'Add to Exceptions',
                                valign: Gtk.Align.CENTER,
                                css_classes: ['suggested-action']
                            });
                            addButton.connect('clicked', () => {
                                if (!customExceptions.map(e => e.toLowerCase()).includes(identifier)) {
                                    customExceptions.push(identifier);
                                    saveCustomExceptions();
                                    populateExceptions();
                                    populateWindowList(); // Refresh to update buttons
                                }
                            });
                            row.add_suffix(addButton);
                        } else {
                            const label = new Gtk.Label({
                                label: 'Already Added',
                                valign: Gtk.Align.CENTER,
                                css_classes: ['dim-label']
                            });
                            row.add_suffix(label);
                        }

                        windowsExpanderRow.add_row(row);
                        windowRows.push(row);
                    }
                }
            } catch (e) {
                console.error('Failed to get window list:', e);
                // Fallback message if extension is not running or D-Bus call fails
                const errorRow = new Adw.ActionRow({
                    title: 'Unable to detect windows',
                    subtitle: 'Make sure the extension is enabled and running',
                    sensitive: false
                });
                windowsExpanderRow.add_row(errorRow);
                windowRows.push(errorRow);

                // Add manual instruction as fallback
                const manualRow = new Adw.ActionRow({
                    title: 'Manual Method',
                    subtitle: 'Press Alt+F2, type "lg", go to Windows tab to find identifiers'
                });
                windowsExpanderRow.add_row(manualRow);
                windowRows.push(manualRow);
            }
        };

        scanButton.connect('clicked', () => {
            populateWindowList();
            windowsExpanderRow.set_expanded(true);
        });

        // Add new exception row
        const addRow = new Adw.ActionRow({
            title: 'Add Exception Manually',
            subtitle: 'Enter WM_CLASS or App ID'
        });

        const entryBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER
        });

        const entry = new Gtk.Entry({
            placeholder_text: 'e.g. firefox, gnome-terminal',
            hexpand: true
        });

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            css_classes: ['suggested-action'],
            tooltip_text: 'Add exception'
        });

        const addException = () => {
            const text = entry.get_text().trim().toLowerCase();
            const allExceptions = getAllExceptions().map(e => e.toLowerCase());
            if (text && !allExceptions.includes(text)) {
                customExceptions.push(text);
                saveCustomExceptions();
                populateExceptions();
                entry.set_text('');
            }
        };

        addButton.connect('clicked', addException);
        entry.connect('activate', addException);

        entryBox.append(entry);
        entryBox.append(addButton);
        addRow.add_suffix(entryBox);

        groupExceptions.add(addRow);

        // Initial population
        populateExceptions();

        // ── KEYBINDINGS ────────────────────────────────────────────
        const groupKeys = new Adw.PreferencesGroup({
            title: 'Keyboard Shortcuts',
            description: 'Configure keyboard shortcuts for window management actions'
        });
        page.add(groupKeys);

        // Window Swapping shortcuts
        const swapExpanderRow = new Adw.ExpanderRow({
            title: 'Window Swapping',
            subtitle: 'Swap windows in different directions'
        });
        groupKeys.add(swapExpanderRow);

        this._addKeybindingRow(swapExpanderRow, settings, 'swap-primary-window',
            'Swap with Primary', 'Swap current window with the primary window');
        this._addKeybindingRow(swapExpanderRow, settings, 'swap-left-window',
            'Swap Left', 'Swap current window with window to the left');
        this._addKeybindingRow(swapExpanderRow, settings, 'swap-right-window',
            'Swap Right', 'Swap current window with window to the right');
        this._addKeybindingRow(swapExpanderRow, settings, 'swap-up-window',
            'Swap Up', 'Swap current window with window above');
        this._addKeybindingRow(swapExpanderRow, settings, 'swap-down-window',
            'Swap Down', 'Swap current window with window below');

        // Window Focus shortcuts
        const focusExpanderRow = new Adw.ExpanderRow({
            title: 'Window Focus',
            subtitle: 'Move focus between windows'
        });
        groupKeys.add(focusExpanderRow);

        this._addKeybindingRow(focusExpanderRow, settings, 'focus-left',
            'Focus Left', 'Move focus to window on the left');
        this._addKeybindingRow(focusExpanderRow, settings, 'focus-right',
            'Focus Right', 'Move focus to window on the right');
        this._addKeybindingRow(focusExpanderRow, settings, 'focus-up',
            'Focus Up', 'Move focus to window above');
        this._addKeybindingRow(focusExpanderRow, settings, 'focus-down',
            'Focus Down', 'Move focus to window below');
    }

    _addKeybindingRow(parent: Adw.ExpanderRow, settings: Gio.Settings, key: string, title: string, subtitle: string): void {
        const row = new Adw.ActionRow({
            title: title,
            subtitle: subtitle
        });

        // Get current shortcut
        const shortcuts = settings.get_strv(key);
        const currentShortcut = shortcuts.length > 0 ? shortcuts[0] : '';

        // Create shortcut label
        const shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: currentShortcut,
            valign: Gtk.Align.CENTER
        });

        // Create edit button
        const editButton = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Edit shortcut'
        });

        // Create clear button
        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Clear shortcut',
            sensitive: currentShortcut !== ''
        });

        // Add widgets to row
        row.add_suffix(shortcutLabel);
        row.add_suffix(editButton);
        row.add_suffix(clearButton);

        // Handle edit button click
        editButton.connect('clicked', () => {
            this._captureKeybinding(settings, key, shortcutLabel, clearButton);
        });

        // Handle clear button click
        clearButton.connect('clicked', () => {
            settings.set_strv(key, []);
            shortcutLabel.set_accelerator('');
            clearButton.set_sensitive(false);
        });

        // Update when settings change
        settings.connect(`changed::${key}`, () => {
            const newShortcuts = settings.get_strv(key);
            const newShortcut = newShortcuts.length > 0 ? (newShortcuts[0] ?? '') : '';
            shortcutLabel.set_accelerator(newShortcut);
            clearButton.set_sensitive(newShortcut !== '');
        });

        parent.add_row(row);
    }

    _captureKeybinding(settings: Gio.Settings, key: string, label: Gtk.ShortcutLabel, clearButton: Gtk.Button): void {
        // Create a dialog for capturing the keybinding
        const dialog = new Adw.MessageDialog({
            heading: 'Set Keyboard Shortcut',
            body: 'Press the key combination you want to use, or press Escape to cancel.'
        });

        // Create a label to show the captured shortcut
        const captureLabel = new Gtk.Label({
            label: 'Press keys...',
            css_classes: ['title-2']
        });
        dialog.set_extra_child(captureLabel);

        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('set', 'Set Shortcut');
        dialog.set_response_enabled('set', false);
        dialog.set_response_appearance('set', Adw.ResponseAppearance.SUGGESTED);

        let capturedAccel = '';

        // Create event controller for key capture
        const keyController = new Gtk.EventControllerKey();
        keyController.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            // Ignore single modifier keys
            if (keyval === Gdk.KEY_Shift_L || keyval === Gdk.KEY_Shift_R ||
                keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R ||
                keyval === Gdk.KEY_Alt_L || keyval === Gdk.KEY_Alt_R ||
                keyval === Gdk.KEY_Super_L || keyval === Gdk.KEY_Super_R ||
                keyval === Gdk.KEY_Meta_L || keyval === Gdk.KEY_Meta_R) {
                return false;
            }

            // Handle Escape to cancel
            if (keyval === Gdk.KEY_Escape) {
                dialog.close();
                return true;
            }

            // Parse the accelerator
            const accel = Gtk.accelerator_name(keyval, state);
            if (accel && accel !== '') {
                capturedAccel = accel;
                captureLabel.set_label(accel);
                dialog.set_response_enabled('set', true);
            }
            return true;
        });

        dialog.add_controller(keyController);

        dialog.connect('response', (dialog, response) => {
            if (response === 'set' && capturedAccel) {
                settings.set_strv(key, [capturedAccel]);
                label.set_accelerator(capturedAccel);
                clearButton.set_sensitive(true);
            }
            dialog.close();
        });

        dialog.present();
    }
}