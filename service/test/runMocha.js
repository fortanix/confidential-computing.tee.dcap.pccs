/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceRoot = fileURLToPath(new URL('../', import.meta.url));

export function runMocha(extraArgs = [], reportDirectory = path.join(serviceRoot, 'test-reports')) {
    fs.mkdirSync(reportDirectory, { recursive: true });
    const reportFile = path.join(reportDirectory, 'mocha.json');
    // A previous passing report must never mask a runner failure.
    fs.rmSync(reportFile, { force: true });
    const result = spawnSync(process.execPath, [
        path.join(serviceRoot, 'node_modules/mocha/bin/mocha.js'),
        '--reporter', 'json', '--reporter-option', `output=${reportFile}`, ...extraArgs,
    ], { cwd: serviceRoot, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    fs.writeFileSync(path.join(reportDirectory, 'mocha.stdout.log'), result.stdout || '');
    fs.writeFileSync(path.join(reportDirectory, 'mocha.stderr.log'), result.stderr || '');
    if (result.error || result.signal || result.status !== 0) {
        const report = fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8') : '';
        throw new Error(`Mocha failed (exit ${result.status}, signal ${result.signal}): ${result.error || ''}\n${result.stderr}\n${report}`);
    }
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    if (!report.stats.tests || report.stats.failures || report.stats.pending) {
        throw new Error(`Mocha suite was incomplete: ${JSON.stringify(report.stats)}`);
    }
    return report;
}
