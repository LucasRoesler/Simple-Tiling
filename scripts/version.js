#!/usr/bin/env node
// Version management script for Simple Tiling extension
// Handles version synchronization between package.json and metadata.json

import { execSync } from 'child_process';
import { readJSON, writeJSON } from './utils.js';


async function updateMetadata() {
    const pkg = await readJSON('package.json');
    const meta = await readJSON('metadata.json');

    const newVersion = pkg.version;
    const oldVersion = meta['version-name'];

    if (newVersion === oldVersion) {
        console.log(`✓ Version unchanged (${newVersion})`);
        return;
    }

    console.log(`Version changed from ${oldVersion} to ${newVersion}`);

    // Increment build number
    const oldBuild = Number(meta.version) || 0;
    const newBuild = oldBuild + 1;

    meta.version = newBuild;
    meta['version-name'] = newVersion;

    await writeJSON('metadata.json', meta);
    console.log(`✓ Updated metadata.json: version=${newBuild}, version-name=${newVersion}`);
}

function bump(type) {
    const valid = new Set(['major', 'minor', 'patch']);
    if (!valid.has(type)) {
        throw new Error(`Invalid bump type: ${type}. Use major|minor|patch`);
    }

    console.log(`Bumping ${type} version...`);
    execSync(`npm version ${type} --no-git-tag-version`, { stdio: 'inherit' });
}

function setVersion(semver) {
    if (!/^\d+\.\d+\.\d+$/.test(semver || '')) {
        throw new Error(`Invalid version: ${semver}. Expected x.y.z format`);
    }

    console.log(`Setting version to ${semver}...`);
    execSync(`npm version ${semver} --no-git-tag-version --allow-same-version`, { stdio: 'inherit' });
}

async function show() {
    const pkg = await readJSON('package.json');
    const meta = await readJSON('metadata.json');

    console.log('Current version information:');
    console.log(`  Semantic version: ${pkg.version}`);
    console.log(`  Build number: ${meta.version}`);
    console.log(`  Display version: ${meta['version-name']}`);
}

// Main
const [, , cmd, arg] = process.argv;

try {
    switch (cmd) {
        case 'update-metadata':
            await updateMetadata();
            break;

        case 'bump-major':
        case 'bump-minor':
        case 'bump-patch':
            bump(cmd.replace('bump-', ''));
            await updateMetadata();
            break;

        case 'set-version':
            setVersion(arg);
            await updateMetadata();
            break;

        case 'show':
        case 'info':
            await show();
            break;

        default:
            console.error('Usage: node scripts/version.js <command> [args]');
            console.error('');
            console.error('Commands:');
            console.error('  update-metadata    Sync metadata.json with package.json');
            console.error('  bump-major         Bump major version (x.0.0)');
            console.error('  bump-minor         Bump minor version (x.y.0)');
            console.error('  bump-patch         Bump patch version (x.y.z)');
            console.error('  set-version x.y.z  Set specific version');
            console.error('  show               Display current version');
            process.exitCode = 1;
    }
} catch (err) {
    console.error('Error:', err.message || err);
    process.exitCode = 1;
}