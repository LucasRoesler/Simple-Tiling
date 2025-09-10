#!/usr/bin/env node
// Minimal shared utilities for build scripts

import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

// Simple JSON file operations
export async function readJSON(file) {
    return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJSON(file, data) {
    await writeFile(file, JSON.stringify(data, null, 2));
}

// Ensure directory exists
export async function ensureDir(dir) {
    await mkdir(dir, { recursive: true });
}

// Remove file or directory
export async function remove(path) {
    if (existsSync(path)) {
        await rm(path, { recursive: true, force: true });
    }
}

// Check if command exists
export function commandExists(cmd) {
    try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}