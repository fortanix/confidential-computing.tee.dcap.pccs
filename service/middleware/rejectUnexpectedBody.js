/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import PccsStatus from '../constants/pccs_status_code.js';
import PccsError from '../utils/PccsError.js';

// kept in sync with the routers' mount points in pccs_server.js
// endpoints whose controllers read req.body; every other path (including unmatched ones) gets a 0-byte limit
const BODY_ALLOWED_ENDPOINTS = [
    { method: 'POST', path: '/sgx/certification/v3/platforms' },
    { method: 'POST', path: '/sgx/certification/v4/platforms' },
    { method: 'PUT', path: '/sgx/certification/v3/platformcollateral' },
    { method: 'PUT', path: '/sgx/certification/v4/platformcollateral' },
    { method: 'PUT', path: '/sgx/certification/v3/appraisalpolicy' },
    { method: 'PUT', path: '/sgx/certification/v4/appraisalpolicy' },
];

function hasDeclaredBody(req) {
    return Number(req.headers['content-length']) > 0 || 'transfer-encoding' in req.headers;
}

function isBodyAllowed(method, path) {
    if (global.PCS_VERSION < 4 && path.startsWith('/sgx/certification/v4/')) {
        return false;
    }
    return BODY_ALLOWED_ENDPOINTS.some(
        (endpoint) => endpoint.method === method && endpoint.path.toLowerCase() === path.toLowerCase()
    );
}

export default function rejectUnexpectedBody(req, res, next) {
    if (!hasDeclaredBody(req)) {
        return next();
    }

    if (isBodyAllowed(req.method, req.path)) {
        return next();
    }

    throw new PccsError(PccsStatus.PCCS_STATUS_CONTENT_TOO_LARGE);
}
