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

import Config from 'config';
import got from 'got';
import logger, { parseAndShortenUrlForLogging } from '../utils/Logger.js';
import PccsError from '../utils/PccsError.js';
import PccsStatus from '../constants/pccs_status_code.js';
import Constants from '../constants/index.js';
import { sanitizedProxyForLogging, httpsProxyAgent } from './proxy.js';

const HTTP_TIMEOUT = (Config.has('PcsRequestTimeoutSeconds') ? Config.get('PcsRequestTimeoutSeconds') : 16) * 1000;
const MAX_RETRY_COUNT = Config.has('PcsMaxRetryCount') ? Config.get('PcsMaxRetryCount') : 2;

export function isEarlyAccessPortal(url) {
    return url.startsWith('https://validation.api.trustedservices.intel.com/');
}

function addApiKeyIfPresent(headers) {
    if (Config.has('ApiKey') && Config.get('ApiKey') !== '') {
        headers['Ocp-Apim-Subscription-Key'] = Config.get('ApiKey');
    }
    return headers;
}

async function doRequest(url, options) {
    const shortenUrl = parseAndShortenUrlForLogging(url);
    const startedAt = Date.now();
    try {
        if (url.indexOf('/v3/') >= 0) {
            throw new PccsError(PccsStatus.PCCS_STATUS_PCS_V3_REACHED_EOL);
        }

        // check for early access portal
        if (isEarlyAccessPortal(url)) {
            if (!options.headers) {
                options.headers = {};
            }
            addApiKeyIfPresent(options.headers);
        }

        // global options (proxy, timeout, etc)
        if (httpsProxyAgent) {
            options.agent = { https: httpsProxyAgent };
        }
        options.timeout = { request: HTTP_TIMEOUT };
        options.retry = {
            limit:   MAX_RETRY_COUNT,
            methods: ['GET', 'PUT', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE', 'POST'],
        };
        if (!options.responseType) {
            options.responseType = 'text';
        }
        options.throwHttpErrors = false;

        logger.info(`[PCS Request Start][URL=${shortenUrl}][Proxy=${sanitizedProxyForLogging}][TimeoutMs=${HTTP_TIMEOUT}]`);
        const response = await got(url, options);
        const warning = response.headers.warning ? `[Warning=${response.headers.warning}]` : '';
        logger.info(`[Request-ID=${response.headers['request-id']}][URL=${shortenUrl}] -> [Status=${response.statusCode}][ElapsedMs=${Date.now() - startedAt}]${warning}`);

        if (response.statusCode !== Constants.HTTP_SUCCESS) {
            if (response.statusCode === 400) {
                if (response.headers['error-code'] && response.headers['error-message']) {
                    logger.error(`[Error-Code=${response.headers['error-code']}][Error-Message=${response.headers['error-message']}]`);
                }
            }
        }

        return response;
    } catch (err) {
        if (err.status === PccsStatus.PCCS_STATUS_PCS_V3_REACHED_EOL[0]) {
            throw err;
        }
        logger.error(`[PCS Request Failed][URL=${shortenUrl}][ElapsedMs=${Date.now() - startedAt}]`);
        logger.error(err);

        if (err.response && err.response.headers) {
            logger.info(`Request-ID is : ${err.response.headers['request-id']}`);
        }
        throw new PccsError(PccsStatus.PCCS_STATUS_PCS_ACCESS_FAILURE);
    }
}

function getTdxUrl(url) {
    return url.replace('/sgx/', '/tdx/');
}

/*
export async function getCert(enc_ppid, cpusvn, pcesvn, pceid) {
  const options = {
    searchParams: {
      encrypted_ppid: enc_ppid,
      cpusvn: cpusvn,
      pcesvn: pcesvn,
      pceid: pceid,
    },
    method: 'GET',
    headers: addApiKeyIfPresent({}),
  };

  return doRequest(Config.get('uri') + 'pckcert', options);
}
*/

export async function getCerts(encPpid, pceid) {
    const options = {
        searchParams: {
            encrypted_ppid: encPpid,
            pceid,
        },
        method:  'GET',
        headers: addApiKeyIfPresent({}),
    };

    return doRequest(`${Config.get('uri')}pckcerts`, options);
}

export async function getCertsWithManifest(platformManifest, pceid) {
    const options = {
        json: {
            platformManifest,
            pceid,
        },
        method:  'POST',
        headers: addApiKeyIfPresent({ 'Content-Type': 'application/json' }),
    };

    return doRequest(`${Config.get('uri')}pckcerts`, options);
}

export async function getPckCrl(ca) {
    const options = {
        searchParams: {
            ca:       ca.toLowerCase(),
            encoding: 'der',
        },
        responseType: 'buffer',
        method:       'GET',
    };

    return doRequest(`${Config.get('uri')}pckcrl`, options);
}

export async function getTcb(type, fmspc, version, updateType) {
    if (version === 3) {
        throw new PccsError(PccsStatus.PCCS_STATUS_PCS_V3_REACHED_EOL);
    }
    if (type !== Constants.PROD_TYPE_SGX && type !== Constants.PROD_TYPE_TDX) {
        throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
    }

    if (updateType !== Constants.UPDATE_TYPE_STANDARD && updateType !== Constants.UPDATE_TYPE_EARLY) {
        throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
    }
    const update = updateType === Constants.UPDATE_TYPE_EARLY ? 'early' : 'standard';

    const options = {
        searchParams: {
            fmspc,
            update
        },
        method: 'GET',
    };

    let uri = `${Config.get('uri')}tcb`;
    if (type === Constants.PROD_TYPE_TDX) {
        uri = getTdxUrl(uri);
    }

    return doRequest(uri, options);
}

export async function getEnclaveIdentity(enclaveId, version, updateType) {
    if (version === 3) {
        throw new PccsError(PccsStatus.PCCS_STATUS_PCS_V3_REACHED_EOL);
    }
    if (
        enclaveId !== Constants.QE_IDENTITY_ID &&
        enclaveId !== Constants.QVE_IDENTITY_ID &&
        enclaveId !== Constants.TDQE_IDENTITY_ID
    ) {
        throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
    }
    if (updateType !== Constants.UPDATE_TYPE_STANDARD && updateType !== Constants.UPDATE_TYPE_EARLY) {
        throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
    }
    const update = updateType === Constants.UPDATE_TYPE_EARLY ? 'early' : 'standard';

    const options = {
        searchParams: {
            update
        },
        method: 'GET',
    };

    let uri = `${Config.get('uri')}qe/identity`;
    if (enclaveId === Constants.QVE_IDENTITY_ID) {
        uri = `${Config.get('uri')}qve/identity`;
    } else if (enclaveId === Constants.TDQE_IDENTITY_ID) {
        uri = getTdxUrl(uri);
    }

    return doRequest(uri, options);
}

export async function getFileFromUrl(uri) {
    const shortenUri = parseAndShortenUrlForLogging(uri);
    const startedAt = Date.now();
    const options = {
        timeout: { request: HTTP_TIMEOUT },
    };
    if (httpsProxyAgent) {
        options.agent = { https: httpsProxyAgent };
    }

    try {
        logger.info(
            `[File Download Start][URL=${shortenUri}][Proxy=${sanitizedProxyForLogging}][TimeoutMs=${HTTP_TIMEOUT}]`
        );
        const content = await got(uri, options).buffer();
        logger.info(
            `[File Download Finished][URL=${shortenUri}][ElapsedMs=${Date.now() - startedAt}]`
        );
        return Buffer.from(content);
    } catch (err) {
        logger.error(
            `[File Download Failed][URL=${shortenUri}][ElapsedMs=${Date.now() - startedAt}]`
        );
        logger.error('Failed to download file for the given uri.');
        throw err;
    }
}

export function getHeaderValue(headers, key) {
    return headers[key.toLowerCase()];
}
