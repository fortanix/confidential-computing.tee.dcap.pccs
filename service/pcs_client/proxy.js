/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import Config from 'config';
import { HttpsProxyAgent } from 'https-proxy-agent';

export function getEnv(key) {
    // eslint-disable-next-line n/no-process-env
    return process.env[key.toLowerCase()] || process.env[key.toUpperCase()] || '';
}

export function sanitizeProxyUrlForLogging(proxyUrl) {
    if (!proxyUrl || proxyUrl === 'disabled') {
        return proxyUrl;
    }
    try {
        const parsed = new URL(proxyUrl);
        parsed.username = '';
        parsed.password = '';
        return parsed.toString();
    } catch {
        return 'invalid proxy url';
    }
}

const proxySetInConfig = Config.has('proxy') ? String(Config.get('proxy') || '').trim() : '';
const proxySetInEnv = getEnv('https_proxy') || getEnv('http_proxy') || getEnv('all_proxy');
export const configuredProxy = proxySetInConfig || proxySetInEnv || 'disabled';
export const sanitizedProxyForLogging = sanitizeProxyUrlForLogging(configuredProxy);
export const httpsProxyAgent = configuredProxy !== 'disabled' && sanitizedProxyForLogging !== 'invalid proxy url' ? new HttpsProxyAgent(configuredProxy) : undefined;
