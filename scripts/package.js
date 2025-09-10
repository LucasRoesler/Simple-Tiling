#!/usr/bin/env node
// Package script for Simple Tiling GNOME Shell extension

import { readJSON, commandExists } from './utils.js';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

async function getConfig() {
    const pkg = await readJSON('package.json');
    const meta = await readJSON('metadata.json');
    return {
        uuid: meta.uuid,
        version: pkg.version,
        buildDir: meta.uuid
    };
}

function packageDev(config) {
    console.log('Creating development package...');
    
    const zipName = `${config.uuid}-v${config.version}.zip`;
    
    // Remove existing zip
    execSync(`rm -f ${zipName} 2>/dev/null || true`, { shell: true });
    
    // Create zip
    execSync(`zip -r ${zipName} ${config.buildDir}`);
    
    console.log(`✓ Package created: ${zipName}`);
    
    // Show size
    const size = execSync(`du -h ${zipName} | cut -f1`, { encoding: 'utf8' }).trim();
    console.log(`  Package size: ${size}`);
    
    return zipName;
}

function packageDist(config) {
    console.log('Creating distribution package...');
    
    if (!commandExists('gnome-extensions')) {
        console.log('⚠️  gnome-extensions not found, falling back to dev package');
        return packageDev(config);
    }
    
    const expectedOutput = `${config.uuid}.shell-extension.zip`;
    
    // Remove existing package
    execSync(`rm -f ${expectedOutput} 2>/dev/null || true`, { shell: true });
    
    // Build extra sources list
    const extraSources = ['README.md', 'LICENSE', 'exceptions.txt']
        .filter(existsSync)
        .map(f => `--extra-source=${f}`)
        .join(' ');
    
    try {
        execSync(`gnome-extensions pack ${config.buildDir} --force ${extraSources}`);
        
        // Rename with version
        const versionedName = `${config.uuid}-v${config.version}-dist.zip`;
        execSync(`mv ${expectedOutput} ${versionedName}`);
        
        console.log(`✓ Distribution package created: ${versionedName}`);
        
        // Show size
        const size = execSync(`du -h ${versionedName} | cut -f1`, { encoding: 'utf8' }).trim();
        console.log(`  Package size: ${size}`);
        
        return versionedName;
    } catch (err) {
        console.error('Error creating distribution package, falling back to dev package');
        return packageDev(config);
    }
}

function validatePackage(packageFile) {
    if (!existsSync(packageFile)) {
        throw new Error(`Package file not found: ${packageFile}`);
    }
    
    console.log('Validating package contents...');
    
    const contents = execSync(`unzip -l ${packageFile}`, { encoding: 'utf8' });
    
    const required = ['metadata.json', 'extension.js', 'prefs.js'];
    const missing = required.filter(f => !contents.includes(f));
    
    if (missing.length > 0) {
        console.log(`⚠️  Missing files: ${missing.join(', ')}`);
        return false;
    }
    
    console.log('✓ Package validation passed');
    return true;
}

function listPackages() {
    console.log('Existing packages:');
    try {
        const output = execSync('ls -lh *.zip', { encoding: 'utf8' });
        console.log(output);
    } catch {
        console.log('No packages found');
    }
}

// Main
const [,, command, arg] = process.argv;

try {
    const config = await getConfig();
    
    // Check if build exists
    if (!existsSync(config.buildDir) && command !== 'list') {
        throw new Error('Build directory not found. Run build first.');
    }
    
    switch (command) {
        case 'dev':
        case 'development':
            packageDev(config);
            break;
            
        case 'dist':
        case 'distribution':
        case 'release':
            packageDist(config);
            break;
            
        case 'validate':
            if (!arg) {
                throw new Error('Usage: node scripts/package.js validate <package.zip>');
            }
            validatePackage(arg);
            break;
            
        case 'list':
            listPackages();
            break;
            
        default:
            // Default to dev package
            packageDev(config);
            break;
    }
} catch (err) {
    console.error('Package error:', err.message || err);
    process.exitCode = 1;
}