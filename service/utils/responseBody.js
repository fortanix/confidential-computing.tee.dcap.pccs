/* Copyright(c) 2026 Intel Corporation
    SPDX-License-Identifier: BSD-3-Clause */

import PccsError from './PccsError.js';
import PccsStatus from '../constants/pccs_status_code.js';
import Constants from '../constants/index.js';
import logger from './Logger.js';

export function getBodyBuffer(response) {
    const { body } = response;

    if (body === null || body === undefined) {
        return null;
    }

    if (Buffer.isBuffer(body)) {
        return body;
    }

    if (typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer) {
        return Buffer.from(body);
    }

    logger.error(`Unsupported response body type: ${typeof body}`);
    throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
}

export function parsePckServerResponseBody(body) {
    if (body === null || body === undefined) {
        logger.error('Unrecognized server response.');
        throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
    }

    if (typeof body === 'string') {
        return JSON.parse(body);
    }

    if (Buffer.isBuffer(body) || body instanceof Uint8Array || body instanceof ArrayBuffer) {
        return JSON.parse(Buffer.from(body).toString('utf8'));
    }

    if (typeof body === 'object') {
        return body;
    }

    logger.error('Unrecognized server response.');
    throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
}

export function isSuccessfulResponseWithBody(response) {
    if (response.statusCode !== Constants.HTTP_SUCCESS) {
        return false;
    }

    const { body } = response;

    if (body === null || body === undefined) {
        return false;
    }

    if (typeof body === 'string') {
        return body.length > 0;
    }

    if (Buffer.isBuffer(body) || body instanceof Uint8Array || body instanceof ArrayBuffer) {
        return Buffer.byteLength(body) > 0;
    }

    if (Array.isArray(body)) {
        return body.length > 0;
    }

    if (typeof body === 'object') {
        return Object.keys(body).length > 0;
    }

    return false;
}
