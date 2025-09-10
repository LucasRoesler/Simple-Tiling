#!/usr/bin/env node
// Installation script for Simple Tiling GNOME Shell extension

import { readJSON, remove, commandExists } from './utils.js';
import { existsSync } from 'fs';
import { cp } from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';

async function getConfig() {
    const pkg = await readJSON('package.json');
    const meta = await readJSON('metadata.json');
    return {
        uuid: meta.uuid,
        buildDir: meta.uuid,
        extDir: `${process.env.HOME}/.local/share/gnome-shell/extensions`
    };
}

async function install(config) {
    console.log('Installing extension...');
    
    const installPath = path.join(config.extDir, config.uuid);
    
    // Remove old installation
    await remove(installPath);
    
    // Copy to extensions directory
    await cp(config.buildDir, installPath, { recursive: true });
    
    console.log(`✓ Extension installed to ${installPath}`);
}

function enable(config) {
    if (!commandExists('gnome-extensions')) {
        console.log('⚠️  gnome-extensions not found, enable manually');
        return false;
    }
    
    console.log('Enabling extension...');
    
    try {
        execSync(`gnome-extensions enable ${config.uuid}`, { stdio: 'pipe' });
        console.log('✓ Extension enabled');
        return true;
    } catch {
        console.log('⚠️  Could not enable extension automatically');
        return false;
    }
}

function disable(config) {
    if (!commandExists('gnome-extensions')) {
        return false;
    }
    
    console.log('Disabling extension...');
    
    try {
        execSync(`gnome-extensions disable ${config.uuid}`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

function checkStatus(config) {
    if (!commandExists('gnome-extensions')) {
        console.log('⚠️  Cannot check status (gnome-extensions not found)');
        return;
    }
    
    try {
        const output = execSync(`gnome-extensions show ${config.uuid}`, { 
            encoding: 'utf8',
            stdio: 'pipe' 
        });
        
        const stateMatch = output.match(/State:\s+(\w+)/);
        if (stateMatch) {
            const state = stateMatch[1];
            console.log(`Extension state: ${state}`);
            
            if (state === 'ACTIVE') {
                console.log('✓ Extension is active and running');
            } else if (state === 'INACTIVE') {
                console.log('⚠️  Extension is installed but not enabled');
            }
        }
    } catch {
        console.log('⚠️  Extension not found in GNOME Shell');
    }
}

function showInstructions(config) {
    console.log('');
    console.log('To enable the extension:');
    console.log(`  gnome-extensions enable ${config.uuid}`);
    console.log('');
    console.log('Restart GNOME Shell:');
    console.log('  X11: Alt+F2, type "r", press Enter');
    console.log('  Wayland: Log out and log back in');
}

async function uninstall(config) {
    console.log('Uninstalling extension...');
    
    disable(config);
    
    const installPath = path.join(config.extDir, config.uuid);
    await remove(installPath);
    
    console.log('✓ Extension uninstalled');
}

async function reinstall(config) {
    console.log('Reinstalling extension...');
    
    disable(config);
    await install(config);
    
    const enabled = enable(config);
    if (!enabled) {
        showInstructions(config);
    }
    
    checkStatus(config);
}

// Main
const command = process.argv[2];

try {
    const config = await getConfig();
    
    // Check if build exists (except for uninstall/status)
    if (!existsSync(config.buildDir) && !['uninstall', 'remove', 'status'].includes(command)) {
        throw new Error('Build directory not found. Run build first.');
    }
    
    switch (command) {
        case 'uninstall':
        case 'remove':
            await uninstall(config);
            break;
            
        case 'reinstall':
            await reinstall(config);
            break;
            
        case 'enable':
            enable(config);
            checkStatus(config);
            break;
            
        case 'disable':
            disable(config);
            checkStatus(config);
            break;
            
        case 'status':
            checkStatus(config);
            break;
            
        default:
            // Default is install
            await install(config);
            const enabled = enable(config);
            if (!enabled) {
                showInstructions(config);
            }
            checkStatus(config);
            break;
    }
} catch (err) {
    console.error('Installation error:', err.message || err);
    process.exitCode = 1;
}