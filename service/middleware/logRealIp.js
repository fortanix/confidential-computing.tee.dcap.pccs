/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import logger from '../utils/Logger.js';

function forwardedAddress(value) {
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate !== 'string') {
        return '';
    }
    return candidate.replace(/[\r\n]/g, '').trim();
}

export default function logRealIp(req, res, next) {
    // Node stores header names in lowercase. A mixed-case lookup never matches.
    const realIp = forwardedAddress(req.headers['x-real-ip']);
    if (realIp) {
        logger.info(`Client X-Real-IP : ${realIp}`);
    }
    next();
}
