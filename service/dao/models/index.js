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
import Sequelize from 'sequelize';
import logger from '../../utils/Logger.js';
import { getSSLConfig } from './mysqlSslConfig.js';
import FmspcTcbs from './fmspc_tcbs.js';
import PckCert from './pck_cert.js';
import PckCertchain from './pck_certchain.js';
import PckCrl from './pck_crl.js';
import PcsCertificates from './pcs_certificates.js';
import PcsVersion from './pcs_version.js';
import PlatformTcbs from './platform_tcbs.js';
import PlatformsRegistered from './platforms_registered.js';
import Platforms from './platforms.js';
import EnclaveIdentities from './enclave_identities.js';
import CrlCache from './crl_cache.js';
import AppraisalPolicy from './appraisal_policy.js';
import mysqlPromise from 'mysql2/promise.js';
import clshooked from 'cls-hooked';

const db_namespace = clshooked.createNamespace('pccs-db-namespace');
Sequelize.useCLS(db_namespace);

import TcbEvalDataNumbers from './tcb_eval_data_numbers.js';

function initModels(sequelize) {
    TcbEvalDataNumbers.init(sequelize);
    FmspcTcbs.init(sequelize);
    PckCert.init(sequelize);
    PckCertchain.init(sequelize);
    PckCrl.init(sequelize);
    PcsCertificates.init(sequelize);
    PcsVersion.init(sequelize);
    PlatformTcbs.init(sequelize);
    PlatformsRegistered.init(sequelize);
    Platforms.init(sequelize);
    EnclaveIdentities.init(sequelize);
    CrlCache.init(sequelize);
    AppraisalPolicy.init(sequelize);
}

async function initializeDatabase() {
    const dbConfig = Config.get(Config.get('DB_CONFIG'));
    const dbOptions = { ...dbConfig.options };
    if (dbOptions.logging === true) {
        dbOptions.logging = (msg) => logger.info(msg);
    }

    const sslOptions = getSSLConfig(dbConfig.ssl);
    if (sslOptions) {
        dbOptions.dialectOptions = sslOptions;
    }

    const sequelize = new Sequelize(
        dbConfig.database,
        dbConfig.username,
        dbConfig.password,
        dbOptions
    );

    try {
        await sequelize.authenticate();
        if (Config.get('DB_CONFIG') === 'sqlite') {
            // WAL (Write-Ahead Logging) mode: instead of blocking all readers during a write,
            // writers append changes to a separate WAL file while readers continue reading
            // the original database. This allows GET requests (e.g. /pckcert, /tcb) to be
            // served without waiting for an ongoing refresh transaction to complete.
            await sequelize.query('PRAGMA journal_mode = WAL;');
            const walMode = await sequelize.query('PRAGMA journal_mode;');
            logger.debug(`SQLite PRAGMA journal_mode set to: ${walMode[0][0].journal_mode}`);

            // NORMAL synchronous mode: SQLite skips fsync after each individual write within
            // a transaction, and only syncs at transaction commit. This is safe against
            // application crashes (data is consistent on commit) but may lose the last
            // committed transaction on OS crash or power failure. Acceptable for a cache
            // that can be rebuilt via refresh. Reduces write latency vs the default FULL mode.
            await sequelize.query('PRAGMA synchronous = NORMAL;');
            const syncMode = await sequelize.query('PRAGMA synchronous;');
            logger.debug(`SQLite PRAGMA synchronous set to: ${syncMode[0][0].synchronous}`);
        }
    } catch (err) {
        if (Config.get('DB_CONFIG') === 'mysql') {
            // Handle MySQL specific error
            await handleMySQLError(dbConfig, dbOptions, err);
        } else {
            logger.error(err);
            logger.endAndExitProcess();
        }
    }

    return sequelize;
}

async function handleMySQLError(dbConfig, dbOptions, err) {
    logger.error(`Failed to connect DB with error ${err.message}. Try to create it ...`);
    try {
        const connOptions = {
            host:     dbOptions.host,
            port:     dbOptions.port,
            user:     dbConfig.username,
            password: dbConfig.password,
            ...getSSLConfig(dbConfig.ssl) ?? {}
        };
        const connection = await mysqlPromise.createConnection(connOptions);
        await connection.query(
            `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8 COLLATE utf8_general_ci;`
        );
    } catch (err2) {
        logger.error(err2);
        logger.endAndExitProcess();
    }
}

const sequelize = await initializeDatabase();
initModels(sequelize); // Initialize all models


export {
    TcbEvalDataNumbers,
    Sequelize,
    sequelize,
    FmspcTcbs,
    PckCert,
    PckCertchain,
    PckCrl,
    PcsCertificates,
    PcsVersion,
    PlatformTcbs,
    PlatformsRegistered,
    Platforms,
    EnclaveIdentities,
    CrlCache,
    AppraisalPolicy,
};
