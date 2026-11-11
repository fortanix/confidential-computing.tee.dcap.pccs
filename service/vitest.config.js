/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/vitest/**/*.test.js'],
        environment: 'node',
        pool: 'forks',
        fileParallelism: false,
        maxWorkers: 1,
        testTimeout: 60000,
        hookTimeout: 15000,
    },
});
