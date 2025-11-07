/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMocha } from '../runMocha.js';

test('runs every Mocha test, requires 460 passes, and fails when any test is pending', () => {
    const report = runMocha();
    expect(report.stats.passes).toBe(460);
    expect(report.tests.some(testCase => testCase.fullTitle.includes('auth bypass regression'))).toBe(true);
    // eslint-disable-next-line no-console -- This line logs report.stats.passes.
    console.info(`Mocha: ${report.stats.passes} passing; detailed report in test-reports/mocha.json`);
});

test('a failing Mocha test rejects the Vitest bridge', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pccs-mocha-negative-'));
    try {
        const fixture = path.join(directory, 'intentional.cjs');
        fs.writeFileSync(fixture, "describe('exit propagation', () => { it('deliberately fails', () => { throw new Error('PCCS deliberate Mocha failure'); }); });");
        expect(() => runMocha(['--no-config', fixture], directory)).toThrow('PCCS deliberate Mocha failure');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
