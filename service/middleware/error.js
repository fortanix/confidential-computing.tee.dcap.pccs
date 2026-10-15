/*
 * Copyright (C) 2011-2026 Intel Corporation
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
 * OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
 * OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
 * OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 *
 * SPDX-License-Identifier: BSD-3-Clause
 */

import PccsError from '../utils/PccsError.js';
import PccsStatus from '../constants/pccs_status_code.js';
import logger from '../utils/Logger.js';

// The response below is always sent first, so any real client already has it long before this
// elapses; only a client that is still sending past this point pays for the forced close below.
const UNREAD_BODY_DRAIN_GRACE_MS = 3000;

// eslint-disable-next-line no-unused-vars
export function errorHandling(err, req, res, next) {
    const hasUnreadBody =
         (Number(req.headers['content-length']) > 0 || 'transfer-encoding' in req.headers) &&
         !req.readableEnded;
    if (hasUnreadBody) {
        // Node already drains an unread body once the response finishes, but only as fast as the
        // client chooses to send; without a cap a stalled upload could hold the connection (and
        // this socket) open for the full requestTimeout. If the grace period elapses first, the
        // socket is destroyed outright: that client loses the connection (and, for HTTP/1.1 with
        // no proxy, any unread bytes still in flight trigger a TCP RST), trading keep-alive reuse
        // for that one connection to bound how long a slow/adversarial sender can occupy it.
        req.on('error', () => {});
        res.once('finish', () => {
            if (req.readableEnded || req.destroyed) {
                return;
            }
            const forceClose = setTimeout(() => req.socket.destroy(), UNREAD_BODY_DRAIN_GRACE_MS);
            forceClose.unref();
            req.once('close', () => clearTimeout(forceClose));
        });
    }

    // Respond immediately regardless of any unread request body; forcing Connection: close
    // here would make Node hard-destroy the socket (destroySoon) before a graceful TLS
    // shutdown, surfacing as a reset/SSLEOFError to the client instead of this response.
    if (err instanceof PccsError) {
        res.status(err.status).send(err.message);
    } else if (err instanceof SyntaxError) {
        logger.error(err.stack);
        res
            .status(PccsStatus.PCCS_STATUS_INVALID_REQ[0])
            .send(PccsStatus.PCCS_STATUS_INVALID_REQ[1]);
    } else if (err.status === 413) {
        logger.error(err.stack);
        res
            .status(PccsStatus.PCCS_STATUS_CONTENT_TOO_LARGE[0])
            .send(PccsStatus.PCCS_STATUS_CONTENT_TOO_LARGE[1]);
    } else {
        logger.error(err.stack);
        res
            .status(PccsStatus.PCCS_STATUS_INTERNAL_ERROR[0])
            .send(PccsStatus.PCCS_STATUS_INTERNAL_ERROR[1]);
    }
}
