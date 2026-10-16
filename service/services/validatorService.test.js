/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import { expect } from 'chai';
import * as validatorService from './validatorService.js';
import PccsStatus from '../constants/pccs_status_code.js';
import Constants from '../constants/index.js';

function assertThrowsInvalidRequest(fn) {
    expect(
        fn,
    ).to.throw().that.has.property('status', PccsStatus.PCCS_STATUS_INVALID_REQ[0]);
}

function getHexOfLength(length) {
    return 'ab'.repeat(length / 2);
}

function getNonHexOfLength(length) {
    return `${'a'.repeat(length - 1)}Z`;
}

describe('validatorService', () => {
    describe('hex validators', () => {
        const cases = [
            {
                name:           'validateAndNormalizeFmspc',
                validator:      validatorService.validateAndNormalizeFmspc,
                expectedLength: 12
            },
            {
                name:           'validateAndNormalizeCpusvn',
                validator:      validatorService.validateAndNormalizeCpusvn,
                expectedLength: 32
            },
            {
                name:           'validateAndNormalizePcesvn',
                validator:      validatorService.validateAndNormalizePcesvn,
                expectedLength: 4
            },
            {
                name:           'validateAndNormalizePceid',
                validator:      validatorService.validateAndNormalizePceid,
                expectedLength: 4
            },
            {
                name:           'validateAndNormalizeEncryptedPpid',
                validator:      validatorService.validateAndNormalizeEncryptedPpid,
                expectedLength: 768,
                allowsMissing:  true
            }
        ];

        cases.forEach(({ name, validator, expectedLength, allowsMissing }) => {
            it(`${name} succeeds for valid hex input`, () => {
                const validHex = getHexOfLength(expectedLength);
                expect(validator(validHex)).to.equal(validHex.toUpperCase());
            });

            if (!allowsMissing) {
                it(`${name} throws for missing input`, () => {
                    assertThrowsInvalidRequest(() => validator(undefined));
                });
            }

            it(`${name} throws for input shorter by one byte`, () => {
                const oneByteShorterHex = getHexOfLength(expectedLength - 2);
                assertThrowsInvalidRequest(() => validator(oneByteShorterHex));
            });

            it(`${name} throws for non-hex input`, () => {
                const nonHexSameLength = getNonHexOfLength(expectedLength);
                assertThrowsInvalidRequest(() => validator(nonHexSameLength));
            });
        });
    });

    describe('validateAndNormalizeEncryptedPpid', () => {
        it('returns undefined when encrypted ppid is undefined', () => {
            expect(validatorService.validateAndNormalizeEncryptedPpid(undefined)).to.equal(undefined);
        });

        it('returns null when encrypted ppid is null', () => {
            expect(validatorService.validateAndNormalizeEncryptedPpid(null)).to.equal(null);
        });
    });

    describe('validateAndNormalizeQeId', () => {
        it('normalizes lower-case qeid', () => {
            expect(validatorService.validateAndNormalizeQeId('qeid_abc')).to.equal('QEID_ABC');
        });

        it('throws for missing qeid', () => {
            assertThrowsInvalidRequest(() => validatorService.validateAndNormalizeQeId(''));
        });

        it('throws when qeid exceeds max size', () => {
            assertThrowsInvalidRequest(() => validatorService.validateAndNormalizeQeId('a'.repeat(261)));
        });
    });

    describe('validateAndNormalizeUpdateType', () => {
        it('defaults update type to STANDARD', () => {
            expect(validatorService.validateAndNormalizeUpdateType(undefined)).to.equal(Constants.UPDATE_TYPE_STANDARD);
        });

        it('normalizes lower-case update type', () => {
            expect(validatorService.validateAndNormalizeUpdateType('early')).to.equal(Constants.UPDATE_TYPE_EARLY);
        });

        it('allows ALL when explicitly enabled', () => {
            expect(validatorService.validateAndNormalizeUpdateType('all', true)).to.equal(Constants.UPDATE_TYPE_ALL);
        });

        it('throws for ALL when not enabled', () => {
            assertThrowsInvalidRequest(() => validatorService.validateAndNormalizeUpdateType('all', false));
        });

        it('throws for unknown update type', () => {
            assertThrowsInvalidRequest(() => validatorService.validateAndNormalizeUpdateType('invalid-value'));
        });
    });
});


describe('evaluation-number query validation', () => {
    it('accepts an omitted update as STANDARD with sentinel tcbedn -1', () => {
        expect(validatorService.validateTcbCollateralQueryParams({})).to.deep.equal({ updateType: 'STANDARD', tcbedn: -1 });
    });

    it('accepts update early as EARLY with sentinel tcbedn -1', () => {
        expect(validatorService.validateTcbCollateralQueryParams({ update: 'early' })).to.deep.equal({ updateType: 'EARLY', tcbedn: -1 });
    });

    for (const value of ['0', '7', '9007199254740991']) {
        it(`accepts explicit evaluation number ${value}`, () => {
            expect(validatorService.validateTcbCollateralQueryParams({ tcbEvaluationDataNumber: value })).to.deep.equal({ updateType: 'TCBEDN', tcbedn: Number(value) });
        });
    }

    for (const [why, value] of [
        ['an empty string', ''],
        ['a negative number', '-1'],
        ['a fraction', '1.5'],
        ['an exponent', '1e2'],
        ['surrounding whitespace', ' 7'],
        ['a non-hex suffix', '7x'],
        ['an array', ['7']],
        ['a value above Number.MAX_SAFE_INTEGER', '9007199254740992'],
    ]) {
        it(`rejects ${why}`, () => {
            assertThrowsInvalidRequest(() => validatorService.validateTcbCollateralQueryParams({ tcbEvaluationDataNumber: value }));
        });
    }

    for (const update of ['standard', 'early', '']) {
        it(`rejects update ${JSON.stringify(update)} together with an evaluation number`, () => {
            assertThrowsInvalidRequest(() => validatorService.validateTcbCollateralQueryParams({
                update,
                tcbEvaluationDataNumber: '7',
            }));
        });
    }
});
