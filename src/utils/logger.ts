/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Logger Utility                    //
//     Original © 2025 Domoel – MIT                       //
//     Fork © 2025 Lucas Roesler – MIT                    //
/////////////////////////////////////////////////////////////

import Gio from 'gi://Gio';

export class Logger {
    private readonly settings: Gio.Settings;

    constructor(settings: Gio.Settings) {
        this.settings = settings;
    }

    private _isEnabled(): boolean {
        return this.settings.get_boolean('debug-logging');
    }

    private _format(level: string, message: string): string {
        const timestamp = new Date().toISOString().split('T')[1]?.slice(0, -1) ?? '';
        return `[SimpleTiling ${timestamp}] ${level}: ${message}`;
    }

    debug(message: string): void {
        if (this._isEnabled()) {
            console.log(this._format('DEBUG', message));
        }
    }

    info(message: string): void {
        if (this._isEnabled()) {
            console.log(this._format('INFO', message));
        }
    }

    error(message: string): void {
        // Errors always emit, regardless of the debug-logging setting, so real
        // failures are never silently dropped.
        console.error(this._format('ERROR', message));
    }
}
