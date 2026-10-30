/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import * as dao from '../dao/tcbEvalDataNumbersDao.js';
import { cachingModeManager } from './caching_modes/cachingModeManager.js';
import Constants from '../constants/index.js';
import PccsError from '../utils/PccsError.js';
import PccsStatus from '../constants/pccs_status_code.js';
import { parseKnownTcbEvaluationDataNumbers } from '../utils/tcbEvalDataNumbers.js';

const activeListRefreshes = new Map();
const lastRefreshAttemptAt = new Map();
const LIST_REFRESH_COOLDOWN_MS = 60000;

export function resetListRefreshStateForTests() {
    activeListRefreshes.clear();
    lastRefreshAttemptAt.clear();
}

export async function getTcbEvalDataNumbers(type) {
    const cached = await dao.getTcbEvalDataNumbers(type);
    if (cached) {
        return {
            contents:                                             cached.contents,
            [Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN]: cached.signing_cert + cached.root_cert
        };
    }
    return cachingModeManager.getTcbEvalDataNumbersFromPCS(type);
}

export async function ensureKnownTcbEvaluationDataNumber(type, tcbedn) {
    const cached = await dao.getTcbEvalDataNumbers(type);
    const parsed = parseKnownTcbEvaluationDataNumbers(cached?.contents);
    if (parsed?.known.has(tcbedn)) {
        return;
    }
    if (Number.isFinite(parsed?.nextUpdate) && Date.now() < parsed.nextUpdate) {
        throw new PccsError(PccsStatus.PCCS_STATUS_INVALID_REQ);
    }

    let refresh = activeListRefreshes.get(type);
    if (!refresh) {
        const lastAttempt = lastRefreshAttemptAt.get(type);
        if (lastAttempt !== undefined && Date.now() - lastAttempt < LIST_REFRESH_COOLDOWN_MS) {
            throw new PccsError(PccsStatus.PCCS_STATUS_INVALID_REQ);
        }
        refresh = Promise.resolve().then(() => cachingModeManager.getTcbEvalDataNumbersFromPCS(type))
            .finally(() => {
                lastRefreshAttemptAt.set(type, Date.now());
                activeListRefreshes.delete(type);
            });
        activeListRefreshes.set(type, refresh);
    }
    const refreshed = await refresh;
    if (!parseKnownTcbEvaluationDataNumbers(refreshed?.contents)?.known.has(tcbedn)) {
        throw new PccsError(PccsStatus.PCCS_STATUS_INVALID_REQ);
    }
}
