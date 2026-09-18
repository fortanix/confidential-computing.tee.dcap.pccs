/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import * as fs from 'fs';
import logger from '../../utils/Logger.js';

export function getSSLConfig(sslConfig) {
    if (!sslConfig || !sslConfig.required) {
        return null;
    }
    const messagePrefix = 'MySQL SSL is required (ssl.required=true) but';
    const messageSuffix = 'Refusing to start with an unencrypted database transport.';
    if (!sslConfig.ca) {
        const message = `${messagePrefix} ssl.ca is not configured. ${messageSuffix}`;
        logger.error(message);
        logger.endAndExitProcess();
        throw new Error(message);
    }
    try {
        if (!fs.existsSync(sslConfig.ca)) {
            throw new Error(`CA file was not found: '${sslConfig.ca}'`);
        }
        return { ssl: { ca: fs.readFileSync(sslConfig.ca) } };
    } catch (err) {
        const message = `${messagePrefix} the configured CA file is not usable: ${err.message}. ${messageSuffix}`;
        logger.error(message);
        logger.endAndExitProcess();
        throw new Error(message, { cause: err });
    }
}
