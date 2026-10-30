/* Copyright (c) Fortanix, Inc. SPDX-License-Identifier: BSD-3-Clause */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/live/**/*.spec.js'],
        environment: 'node',
        env: { NODE_ENV: 'production' },
        fileParallelism: false,
        maxWorkers: 1,
        testTimeout: 180000,
    },
});
