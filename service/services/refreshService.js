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
import PccsError from '../utils/PccsError.js';
import PccsStatus from '../constants/pccs_status_code.js';
import Constants from '../constants/index.js';
import logger from '../utils/Logger.js';
import X509 from '../x509/x509.js';
import * as pckcertDao from '../dao/pckcertDao.js';
import * as enclaveIdentityDao from '../dao/enclaveIdentityDao.js';
import * as pckcrlDao from '../dao/pckcrlDao.js';
import * as platformTcbsDao from '../dao/platformTcbsDao.js';
import * as platformsDao from '../dao/platformsDao.js';
import * as fmspcTcbDao from '../dao/fmspcTcbDao.js';
import * as pckCertchainDao from '../dao/pckCertchainDao.js';
import * as pcsCertificatesDao from '../dao/pcsCertificatesDao.js';
import * as crlCacheDao from '../dao/crlCacheDao.js';
import * as pcsClient from '../pcs_client/pcs_client.js';
import * as appUtil from '../utils/apputil.js';
import * as tcbEvalDataNumbersDao from '../dao/tcbEvalDataNumbersDao.js';
import { getBodyBuffer } from '../utils/responseBody.js';
import { sequelize } from '../dao/models/index.js';
import { cachingModeManager } from './caching_modes/cachingModeManager.js';
import { selectBestPckCert } from '../pckCertSelection/pckCertSelection.js';
import { parseTcbEvalDataNumbersResponse } from '../utils/tcbEvalDataNumbers.js';

const MAX_ENCLAVE_IDENTITY_EDN_SPAN = 100;

function useSequentialDbWrites() {
    return Config.get('DB_CONFIG') === 'sqlite';
}

async function runDbWriteOperations(writeOperations) {
    if (useSequentialDbWrites()) {
        for (const writeOperation of writeOperations) {
            // eslint-disable-next-line no-await-in-loop
            await writeOperation();
        }
        return;
    }

    await Promise.all(writeOperations.map(writeOperation => writeOperation()));
}

// Fetch enclave identities from PCS (HTTP only, no DB writes)
async function fetchEnclaveIdentities() {
    if (global.PCS_VERSION === 3) {
        logger.warn('PCS API version 3 is no longer available. Enclave Identities downloaded using API version 3 will not be refreshed.');
        return [];
    }
    const enclaveIdList = [
        [Constants.QE_IDENTITY_ID, 4],
        [Constants.QVE_IDENTITY_ID, 4],
        [Constants.TDQE_IDENTITY_ID, 4],
    ];
    const updateTypes = [Constants.UPDATE_TYPE_STANDARD, Constants.UPDATE_TYPE_EARLY];
    const cachedIdentities = await enclaveIdentityDao.getAllEnclaveIdentities();
    // Fetch data from PCS in parallel
    const retrievedEnclaveIdentities = await Promise.all(enclaveIdList
        .flatMap(([enclaveId, version]) => updateTypes.map(updateType => [enclaveId, version, updateType]))
        .map(async([enclaveId, version, updateType]) => {
            const pckServerRes = await pcsClient.getEnclaveIdentity(
                enclaveId,
                version,
                updateType
            );
            return {
                enclaveId,
                version,
                updateType,
                statusCode: pckServerRes.statusCode,
                identity:   getBodyBuffer(pckServerRes),
                headers:    pckServerRes.headers
            };
        })
    );
    for (const [enclaveId, version] of enclaveIdList) {
        const evaluationNumbers = new Set(cachedIdentities
            .filter(row => row.id === enclaveId && row.version === version &&
                row.update_type === Constants.UPDATE_TYPE_TCBEDN &&
                Number.isSafeInteger(row.tcbedn) && row.tcbedn >= 0)
            .map(row => row.tcbedn));
        const numbers = new Map();
        for (const item of retrievedEnclaveIdentities.filter(row => row.enclaveId === enclaveId && row.statusCode === Constants.HTTP_SUCCESS && row.identity)) {
            try {
                const number = JSON.parse(item.identity.toString('utf8')).enclaveIdentity?.tcbEvaluationDataNumber;
                if (Number.isSafeInteger(number) && number > 0) {
                    numbers.set(item.updateType, number);
                }
            } catch {
                logger.warn(`Cannot extract evaluation number for enclave identity ${enclaveId}`);
            }
        }
        const standard = numbers.get(Constants.UPDATE_TYPE_STANDARD);
        const early = numbers.get(Constants.UPDATE_TYPE_EARLY);
        if (standard && early) {
            if (standard > early || early - standard > MAX_ENCLAVE_IDENTITY_EDN_SPAN) {
                logger.warn(`Invalid identity evaluation-number range: ${standard}..${early}`);
            } else {
                for (let tcbedn = standard; tcbedn <= early; tcbedn += 1) {
                    evaluationNumbers.add(tcbedn);
                }
            }
        }
        for (const tcbedn of evaluationNumbers) {
            // Keep requests ordered, including cached numbers outside the current range.
            // eslint-disable-next-line no-await-in-loop
            const response = await pcsClient.getEnclaveIdentity(enclaveId, version, Constants.UPDATE_TYPE_TCBEDN, tcbedn);
            retrievedEnclaveIdentities.push({
                enclaveId,
                version,
                updateType: Constants.UPDATE_TYPE_TCBEDN,
                tcbedn,
                statusCode: response.statusCode,
                identity:   getBodyBuffer(response),
                headers:    response.headers
            });
        }
    }
    return retrievedEnclaveIdentities;
}

// Persist enclave identities to DB (DB only, called within transaction)
async function persistEnclaveIdentities(retrievedEnclaveIdentities) {
    await runDbWriteOperations(retrievedEnclaveIdentities.map(({ enclaveId, version, updateType, tcbedn = -1, statusCode, identity }) => async() => {
        if (statusCode === Constants.HTTP_SUCCESS && identity !== null) {
            await enclaveIdentityDao.upsertEnclaveIdentity(
                enclaveId,
                identity,
                version,
                updateType,
                tcbedn
            );
            return;
        }

        logger.debug("Couldn't get enclave identity for (id:%d,version:%d,type:%s)", enclaveId, version, updateType);
    }));

    const somePositivePckServerResponse = retrievedEnclaveIdentities.find(pckServerRes => pckServerRes.statusCode === Constants.HTTP_SUCCESS && pckServerRes.identity !== null);
    if (somePositivePckServerResponse !== undefined) {
        await pcsCertificatesDao.upsertEnclaveIdentityIssuerChain(
            pcsClient.getHeaderValue(
                somePositivePckServerResponse.headers,
                Constants.SGX_ENCLAVE_IDENTITY_ISSUER_CHAIN
            )
        );
    }
}

// Fetch PCK certs from PCS (HTTP only, no DB writes)
async function fetchAllPckcerts(fmspcCsv) {
    const allPlatformTcbs = await platformTcbsDao.getPlatformTcbs(fmspcCsv);

    const platformTcbsGroups = Object.groupBy(
        allPlatformTcbs,
        tcb => `${tcb.qe_id}_${tcb.pce_id}`
    );

    const refreshItems = await Promise.all(Object.entries(platformTcbsGroups).map(async kv => {
        const currentPlatformTcbsGroup = kv[1];
        const qeId = currentPlatformTcbsGroup[0].qe_id;
        const pceId = currentPlatformTcbsGroup[0].pce_id;

        // new platform detected
        const platform = await platformsDao.getPlatform(qeId, pceId);
        // contact Intel PCS server to get PCK certs
        const pckServerCertsRes = platform.platform_manifest ?
            await pcsClient.getCertsWithManifest(
                platform.platform_manifest,
                pceId
            ) :
            await pcsClient.getCerts(
                platform.enc_ppid,
                pceId
            );

        // check HTTP status
        if (pckServerCertsRes.statusCode !== Constants.HTTP_SUCCESS) {
            throw new PccsError(PccsStatus.PCCS_STATUS_NO_CACHE_DATA);
        }

        const pckCertChain = pcsClient.getHeaderValue(
            pckServerCertsRes.headers,
            Constants.SGX_PCK_CERTIFICATE_ISSUER_CHAIN
        );

        // Parse the response body
        const pckcerts = JSON.parse(pckServerCertsRes.body);
        if (pckcerts.length === 0) {
            logger.error("The response body doesn't include PCK certificates.");
            throw new PccsError(PccsStatus.PCCS_STATUS_NO_CACHE_DATA);
        }

        // Get fmspc and ca type from response header
        const fmspcHeader = pcsClient.getHeaderValue(
            pckServerCertsRes.headers,
            Constants.SGX_FMSPC
        );
        const caTypeHeader = pcsClient.getHeaderValue(
            pckServerCertsRes.headers,
            Constants.SGX_PCK_CERTIFICATE_CA_TYPE
        );

        if (typeof fmspcHeader !== 'string' || typeof caTypeHeader !== 'string') {
            logger.error("The response header doesn't include fmspc or ca.");
            throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
        }

        const fmspc = fmspcHeader.toUpperCase();
        const caType = caTypeHeader.toUpperCase();

        // get tcbinfo for this fmspc
        const pckServerTcbRes = await pcsClient.getTcb(
            Constants.PROD_TYPE_SGX,
            fmspc,
            global.PCS_VERSION,
            Constants.UPDATE_TYPE_EARLY
        );
        if (pckServerTcbRes.statusCode !== Constants.HTTP_SUCCESS) {
            throw new PccsError(PccsStatus.PCCS_STATUS_NO_CACHE_DATA);
        }

        const tcbInfoObj = JSON.parse(pckServerTcbRes.body).tcbInfo;
        const decodedCerts = pckcerts.map(cert => ({
            tcbm:     cert.tcbm.toUpperCase(),
            pck_cert: decodeURIComponent(cert.cert)
        }));

        const selectedPlatformTcbs = currentPlatformTcbsGroup.map(platformTcb => {
            // get the best cert
            let selectedPckCert;
            try {
                selectedPckCert = selectBestPckCert(platformTcb.cpu_svn, platformTcb.pce_svn, platformTcb.pce_id, decodedCerts, tcbInfoObj);
            } catch {
                throw new PccsError(PccsStatus.PCCS_STATUS_NO_CACHE_DATA);
            }

            return {
                platformTcb,
                selectedTcbm: selectedPckCert.tcbm,
            };
        });

        return {
            qeId,
            pceId,
            caType,
            pckCertChain,
            pckcerts,
            selectedPlatformTcbs,
        };
    }));
    return refreshItems;
}

// Persist PCK certs to DB (DB only, called within transaction)
async function persistAllPckcerts(refreshItems) {
    await runDbWriteOperations(refreshItems.map(item => async() => {
        await pckcertDao.deleteCerts(item.qeId, item.pceId);

        const pckCertWriteOperations = item.pckcerts.map(pckcert => async() => await pckcertDao.upsertPckCert(
            item.qeId,
            item.pceId,
            pckcert.tcbm,
            decodeURIComponent(pckcert.cert)
        ));

        const platformTcbWriteOperations = item.selectedPlatformTcbs.map(selected => async() => await platformTcbsDao.upsertPlatformTcbs(
            selected.platformTcb.qe_id,
            selected.platformTcb.pce_id,
            selected.platformTcb.cpu_svn,
            selected.platformTcb.pce_svn,
            selected.selectedTcbm
        ));

        const chainWriteOperations = [];
        if (item.pckCertChain) {
            chainWriteOperations.push(async() => {
                await pckCertchainDao.upsertPckCertchain(item.caType);
                await pcsCertificatesDao.upsertPckCertificateIssuerChain(
                    item.caType,
                    item.pckCertChain
                );
            });
        }

        const writeOperations = [
            ...pckCertWriteOperations,
            ...platformTcbWriteOperations,
            ...chainWriteOperations,
        ];

        await runDbWriteOperations(writeOperations);
    }));
}

// Fetch one PCK CRL from PCS (HTTP only, no DB writes)
async function fetchOneCrl(ca) {
    const pckServerRes = await pcsClient.getPckCrl(ca);
    const crl = getBodyBuffer(pckServerRes);
    if (pckServerRes.statusCode === Constants.HTTP_SUCCESS && crl !== null) {
        return {
            ca,
            statusCode: pckServerRes.statusCode,
            crl,
            headers:    pckServerRes.headers
        };
    } else {
        throw new PccsError(PccsStatus.PCCS_STATUS_SERVICE_UNAVAILABLE);
    }
}

// Fetch all PCK CRLs from PCS (HTTP only, no DB writes)
async function fetchAllPckCrls() {
    const pckcrls = await pckcrlDao.getAllPckCrls();
    return Promise.all(pckcrls.map(pckcrl => fetchOneCrl(pckcrl.ca)));
}

// Persist PCK CRLs to DB (DB only, called within transaction)
async function persistAllPckCrls(crlResults) {
    await runDbWriteOperations(crlResults.map(({ ca, crl, headers }) => async() => {
        await pckcrlDao.upsertPckCrl(ca, crl);
        await pcsCertificatesDao.upsertPckCrlCertchain(
            ca,
            pcsClient.getHeaderValue(
                headers,
                Constants.SGX_PCK_CRL_ISSUER_CHAIN
            )
        );
    }));
}

// Fetch root CA CRL from URL (HTTP only, no DB writes)
async function fetchRootcaCrl() {
    const rootca = await pcsCertificatesDao.getCertificateById(
        Constants.ROOT_CERT_ID
    );
    if (!rootca) {
        throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
    }

    const x509 = new X509();
    if (!x509.parseCert(decodeURIComponent(rootca.cert)) || !x509.cdpUri) {
        logger.error('Invalid PCS certificate.');
        throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
    }

    if (!appUtil.isValidCrlUri(x509.cdpUri)) {
        logger.error('Invalid CDP URI.');
        throw new PccsError(PccsStatus.PCCS_STATUS_INTERNAL_ERROR);
    }

    const crl = await pcsClient.getFileFromUrl(x509.cdpUri);
    return { id: rootca.id, crl };
}

// Persist root CA CRL to DB (DB only, called within transaction)
async function persistRootcaCrl(rootcaCrlData) {
    await pcsCertificatesDao.upsertPcsCertificates({
        id:  rootcaCrlData.id,
        crl: rootcaCrlData.crl,
    });
}

// Fetch CRL cache entries from URLs (HTTP only, no DB writes)
async function fetchCachedCrls() {
    const crlCaches = await crlCacheDao.getAllCrls();
    const crls = await Promise.all(crlCaches.map(async crlCache => {
        // refresh each crl
        if (!appUtil.isValidCrlUri(crlCache.cdp_url)) {
            logger.error('Invalid CDP URI.');
            return [false, false];
        }
        const crl = await pcsClient.getFileFromUrl(crlCache.cdp_url);
        return [crlCache.cdp_url, crl];
    }));
    return crls;
}

// Persist CRL cache entries to DB (DB only, called within transaction)
async function persistCachedCrls(crls) {
    await runDbWriteOperations(crls
        .filter(([cdpUrl, crl]) => cdpUrl && crl)
        .map(([cdpUrl, crl]) => async() => {
            await crlCacheDao.upsertCrl(cdpUrl, crl);
        }));
}

// Cleanup invalid TCBs (delete type==null records) - done early to avoid blocking fetch phase
async function cleanupInvalidTcbs() {
    await fmspcTcbDao.deleteInvalidTcbs();
}

// Fetch TCB infos from PCS (HTTP only, no DB writes)
async function fetchAllTcbs() {
    const tcbs = await fmspcTcbDao.getAllTcbs();
    if (tcbs.findIndex(tcb => tcb.version === 3) > -1) {
        logger.warn('PCS API version 3 is no longer available. TCB Info collateral downloaded from API version 3 is deprecated and will not be refreshed.');
        logger.warn('');
        logger.warn('Consider removal of collateral version 3 with SQL statements such as:');
        logger.warn('DELETE FROM enclave_identities WHERE version = 3;');
        logger.warn('DELETE FROM fmspc_tcbs WHERE version = 3;');
        logger.warn('');
    }

    const downloadedTcbInfos = await Promise.all(tcbs
        .filter(tcb => tcb.version > 3)
        .map(async tcb => {
            const pckServerRes = await pcsClient.getTcb(
                tcb.type,
                tcb.fmspc,
                tcb.version,
                tcb.update_type,
                tcb.tcbedn ?? -1
            );
            return {
                type:        tcb.type,
                fmspc:       tcb.fmspc,
                version:     tcb.version,
                update_type: tcb.update_type,
                tcbedn:      tcb.tcbedn ?? -1,
                statusCode:  pckServerRes.statusCode,
                tcbInfo:     getBodyBuffer(pckServerRes),
                headers:     pckServerRes.headers
            };
        }));
    return downloadedTcbInfos;
}

// Persist TCB infos to DB (DB only, called within transaction)
async function persistAllTcbs(downloadedTcbInfos) {
    await runDbWriteOperations(downloadedTcbInfos.map(({ type, fmspc, version, update_type, tcbedn, statusCode, tcbInfo, headers }) => async() => {
        if (statusCode === Constants.HTTP_SUCCESS && tcbInfo !== null) {
            await fmspcTcbDao.upsertFmspcTcb({
                type,
                fmspc,
                version,
                update_type,
                tcbedn,
                tcbinfo: tcbInfo,
            });

            await pcsCertificatesDao.upsertTcbInfoIssuerChain(
                pcsClient.getHeaderValue(
                    headers,
                    appUtil.getTcbInfoIssuerChainName(version)
                )
            );
            return;
        }

        if (statusCode === Constants.HTTP_NOT_FOUND || statusCode === Constants.HTTP_GONE) {
            logger.info(`TCB collateral retired for fmspc:${fmspc}, tcbedn:${tcbedn}, status:${statusCode}`);
            return;
        }
        logger.error(`Failed to get tcbinfo for fmspc:${fmspc}`);
        throw new PccsError(PccsStatus.PCCS_STATUS_SERVICE_UNAVAILABLE);
    }));
}

// Fetch SGX and TDX TCB evaluation data number lists from PCS (HTTP only, non-fatal per list)
async function fetchTcbEvalDataNumbers() {
    const results = await Promise.all([Constants.PROD_TYPE_SGX, Constants.PROD_TYPE_TDX].map(async prodType => {
        try {
            return {
                type: prodType,
                ...parseTcbEvalDataNumbersResponse(await pcsClient.getTcbEvalDataNumbers(prodType)),
            };
        } catch (err) {
            logger.warn(`Failed to get TCB evaluation data numbers for type ${prodType}: ${err.message || err}`);
            return null;
        }
    }));
    return results.filter(result => result !== null);
}

// Serializes transactions across *different* refresh keys when using SQLite: per-key coalescing
// (activeRefreshes) only dedupes identical refreshes, so two distinct keys (e.g. different fmspc, or
// certs vs collateral) could otherwise open concurrent transactions and hit SQLITE_BUSY once the busy
// timeout elapses, since SQLite (even in WAL mode) allows only one writer at a time.
let sqliteWriteQueue = Promise.resolve();

function runExclusiveIfSqlite(writeOperation) {
    if (!useSequentialDbWrites()) {
        return writeOperation();
    }

    const queuedAt = Date.now();
    const runAndLogQueueWait = () => {
        logger.info(`[refreshCache] Including SQLite write queue wait durationMs=${Date.now() - queuedAt}`);
        return writeOperation();
    };

    const result = sqliteWriteQueue.then(runAndLogQueueWait, runAndLogQueueWait);
    // Keep the queue moving even if this write fails; callers still observe the real rejection via `result`.
    sqliteWriteQueue = result.catch(() => {});
    return result;
}

// In-memory coalescing map: concurrent refreshes for the same (type, fmspc) share one Promise.
// Distinct keys are NOT coalesced by this map; runExclusiveIfSqlite handles those.
const activeRefreshes = new Map();

// Perform the actual HTTP fetch + DB persist work for a refresh, outside of any locking concerns.
async function executeRefresh(type, fmspc) {
    if (type === 'certs') {
        if (global.PCS_VERSION > 3) {
            // PHASE 1: Fetch data from HTTP (outside transaction)
            const fetchStart = Date.now();
            const pckCertItems = await fetchAllPckcerts(fmspc);
            logger.info(`[refreshCache] PHASE 1 (HTTP fetch) durationMs=${Date.now() - fetchStart}`);

            // PHASE 2: Persist to DB (inside transaction)
            const persistStart = Date.now();
            await runExclusiveIfSqlite(() => sequelize.transaction(async() => {
                await persistAllPckcerts(pckCertItems);
            }));
            logger.info(`[refreshCache] PHASE 2 (DB persist) durationMs=${Date.now() - persistStart}`);
        } else {
            logger.warn('PCS API version 3 is no longer available. PCK certs downloaded using API version 3 will not be refreshed.');
        }
    } else {
        // Cleanup invalid TCBs before starting fetch phase; queued so it can't race the persist transactions
        await runExclusiveIfSqlite(() => cleanupInvalidTcbs());

        // PHASE 1: Fetch all HTTP data in parallel (outside transaction)
        const fetchStart = Date.now();
        let pckCrlResults; let tcbResults; let enclaveResults; let evaluationNumbers;
        if (global.PCS_VERSION > 3) {
            [pckCrlResults, tcbResults, enclaveResults, evaluationNumbers] = await Promise.all([
                fetchAllPckCrls(),
                fetchAllTcbs(),
                fetchEnclaveIdentities(),
                fetchTcbEvalDataNumbers(),
            ]);
        } else {
            logger.warn('PCS API version 3 is no longer available. PCK CRLs, TCB Infos and Enclave Identities downloaded using API version 3 will not be refreshed.');
        }
        const [rootcaCrlData, cachedCrlResults] = await Promise.all([
            fetchRootcaCrl(),
            fetchCachedCrls(),
        ]);
        logger.info(`[refreshCache] PHASE 1 (HTTP fetch) durationMs=${Date.now() - fetchStart}`);

        // PHASE 2: Persist all to DB in a single transaction
        const persistStart = Date.now();
        await runExclusiveIfSqlite(() => sequelize.transaction(async() => {
            if (global.PCS_VERSION > 3) {
                await persistAllPckCrls(pckCrlResults);
                await persistAllTcbs(tcbResults);
                await persistEnclaveIdentities(enclaveResults);
                await runDbWriteOperations(evaluationNumbers.map(result => async() => {
                    await tcbEvalDataNumbersDao.upsertTcbEvalDataNumbers(result.type, result.contents);
                    await pcsCertificatesDao.upsertTcbInfoIssuerChain(result[Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN]);
                }));
            }
            await persistRootcaCrl(rootcaCrlData);
            await persistCachedCrls(cachedCrlResults);
        }));
        logger.info(`[refreshCache] PHASE 2 (DB persist) durationMs=${Date.now() - persistStart}`);
    }
}

export async function refreshCache(type, fmspc) {
    if (!cachingModeManager.isRefreshable()) {
        throw new PccsError(PccsStatus.PCCS_STATUS_SERVICE_UNAVAILABLE);
    }

    const lockKey = type === 'certs' ? `certs:${fmspc}` : 'collateral';
    if (activeRefreshes.has(lockKey)) {
        logger.info(`[refreshCache] Refresh for key=${lockKey} already in progress, awaiting shared result`);
        return activeRefreshes.get(lockKey);
    }

    // .finally() callbacks always run as a microtask, so the set() below is guaranteed to run first
    // even if executeRefresh() settles synchronously (e.g. PCS_VERSION <= 3 takes no await).
    const refreshPromise = executeRefresh(type, fmspc).finally(() => activeRefreshes.delete(lockKey));
    activeRefreshes.set(lockKey, refreshPromise);
    return refreshPromise;
}

// Schedule the refresh job in cron-style
// # ┌───────────── second (0 - 59)
// # │ ┌───────────── minute (0 - 59)
// # │ │ ┌───────────── hour (0 - 23)
// # │ │ │ ┌───────────── day of the month (1 - 31)
// # │ │ │ │ ┌───────────── month (1 - 12)
// # │ │ │ │ │ ┌───────────── day of the week (0 - 6) (Sunday to Saturday;
// # │ │ │ │ │ │                                   7 is also Sunday on some systems)
// # │ │ │ │ │ │
// # │ │ │ │ │ │
// # * * * * * * command to execute
//

export async function scheduledRefresh() {
    if (!cachingModeManager.isRefreshable()) {
        return;
    }
    try {
        // Reuse refreshCache with type='collateral' to benefit from coalescing lock
        // and avoid duplicate code. Any non-'certs' type triggers the full CRL/TCB/identity refresh.
        await refreshCache('collateral', undefined);
        logger.info('Scheduled cache refresh is completed successfully.');
    } catch (error) {
        logger.error(`Scheduled cache refresh failed: ${error.message || error}`);
    }
}
