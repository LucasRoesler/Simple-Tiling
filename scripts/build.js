#!/usr/bin/env node
// Build script for Simple Tiling GNOME Shell extension

import { readJSON, ensureDir, remove, commandExists } from './utils.js';
import { existsSync } from 'fs';
import { cp } from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';

async function getConfig() {
    const pkg = await readJSON('package.json');
    const meta = await readJSON('metadata.json');
    return {
        uuid: meta.uuid,
        version: pkg.version,
        buildDir: meta.uuid,
        distDir: 'dist'
    };
}

async function clean(config) {
    console.log('Cleaning build artifacts...');
    await remove(config.buildDir);
    await remove(config.distDir);
    
    // Remove any zip files
    execSync('rm -f *.zip 2>/dev/null || true', { shell: true });
    console.log('✓ Build artifacts removed');
}

async function build(config) {
    console.log('Building extension...');
    
    // Create directories
    console.log('Creating build directories...');
    await ensureDir(config.buildDir);
    await ensureDir(path.join(config.buildDir, 'icons'));
    await ensureDir(path.join(config.buildDir, 'schemas'));
    
    // Copy compiled JavaScript
    console.log('Copying compiled JavaScript files...');
    if (!existsSync(config.distDir)) {
        throw new Error('dist directory not found. Run TypeScript build first.');
    }
    await cp(config.distDir, config.buildDir, { recursive: true });
    
    // Copy metadata
    console.log('Copying metadata.json...');
    await cp('metadata.json', path.join(config.buildDir, 'metadata.json'));
    
    // Copy and compile schemas
    console.log('Compiling GSettings schemas...');
    const schemaFile = 'schemas/org.gnome.shell.extensions.simple-tiling.lucasroesler.gschema.xml';
    if (existsSync(schemaFile)) {
        await cp(schemaFile, path.join(config.buildDir, 'schemas', path.basename(schemaFile)));
        execSync(`glib-compile-schemas ${config.buildDir}/schemas`);
    }
    
    // Copy assets
    console.log('Copying additional assets...');
    for (const file of ['README.md', 'LICENSE', 'exceptions.txt']) {
        if (existsSync(file)) {
            await cp(file, path.join(config.buildDir, file));
        }
    }
    
    // Copy icons
    const iconFile = 'icons/tiling-symbolic.svg';
    if (existsSync(iconFile)) {
        await cp(iconFile, path.join(config.buildDir, 'icons', path.basename(iconFile)));
    }
    
    console.log(`✓ Extension built in ${config.buildDir}/`);
}

async function validate(config) {
    console.log('Validating extension...');
    
    if (!commandExists('gnome-extensions')) {
        console.log('⚠️  gnome-extensions command not found, skipping validation');
        return;
    }
    
    try {
        execSync(`gnome-extensions validate ${config.buildDir}`, { stdio: 'pipe' });
        console.log('✓ Extension validation passed');
    } catch (err) {
        console.log('⚠️  Extension validation failed');
        console.log('Check the extension for issues');
    }
}

// Main
const command = process.argv[2];

try {
    const config = await getConfig();
    
    // Check for required commands
    if (command !== 'clean' && !commandExists('glib-compile-schemas')) {
        throw new Error('glib-compile-schemas not found. Install GLib development tools.');
    }
    
    switch (command) {
        case 'clean':
            await clean(config);
            break;
            
        case 'validate':
            await validate(config);
            break;
            
        default:
            await build(config);
            if (commandExists('gnome-extensions')) {
                await validate(config);
            }
            break;
    }
} catch (err) {
    console.error('Build error:', err.message || err);
    process.exitCode = 1;
}