/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Logger Utility                    //
//     Original © 2025 Domoel – MIT                       //
//     Fork © 2025 Lucas Roesler – MIT                    //
/////////////////////////////////////////////////////////////

import Gio from 'gi://Gio';

export class Logger {
    private settings: Gio.Settings;

    constructor(settings: Gio.Settings) {
        this.settings = settings;
    }

    private _isEnabled(): boolean {
        return this.settings.get_boolean('debug-logging');
    }

    private _log(level: string, message: string): void {
        if (!this._isEnabled()) return;
        const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
        const output = `[SimpleTiling ${timestamp}] ${level}: ${message}`;
        console.log(output);
    }

    debug(message: string): void {
        this._log('DEBUG', message);
    }

    info(message: string): void {
        this._log('INFO', message);
    }

    error(message: string): void {
        this._log('ERROR', message);
    }
}
