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

import 'core-js/proposals/reflect-metadata.js';
import { X509Certificate } from '@peculiar/x509';
import { AsnParser } from '@peculiar/asn1-schema';
import { CRLDistributionPoints } from '@peculiar/asn1-x509';
import * as asn1js from 'asn1js';
import logger from '../utils/Logger.js';
import Constants from '../constants/index.js';

const SGX_EXTENSIONS_OID = '1.2.840.113741.1.13.1';
const TAG_OID = 6;
const SGX_EXTENSIONS_FMSPC_OID = '1.2.840.113741.1.13.1.4';
const SGX_EXTENSIONS_PCEID_OID = '1.2.840.113741.1.13.1.3';
const SGX_EXTENSIONS_PPID_OID = '1.2.840.113741.1.13.1.1';
const SGX_EXTENSIONS_TCB_OID = '1.2.840.113741.1.13.1.2';
const X509_EXTENSIONS_CDP_OID = '2.5.29.31';

function assignHexField(target, fieldName, asn1Object) {
    const fieldHex = asn1Object?.valueBlock?.valueHex;
    if (!fieldHex) {
        return;
    }
    target[fieldName] = Buffer.from(fieldHex).toString('hex').toUpperCase();
}

function assignTcbFields(target, asn1Object) {
    const tcbValues = asn1Object?.valueBlock?.value;
    const cpusvnHex = tcbValues?.[17]?.valueBlock?.value?.[1]?.valueBlock?.valueHex;
    const pcesvn = tcbValues?.[16]?.valueBlock?.value?.[1]?.valueBlock?.valueDec;

    if (cpusvnHex) {
        target.cpusvn = Buffer.from(cpusvnHex).toString('hex').toUpperCase();
    }
    if (Number.isInteger(pcesvn)) {
        target.pcesvn = pcesvn;
    }
}

class X509 {
    constructor() {
        if (!(this instanceof X509)) {
            return new X509();
        }

        this.fmspc = null;
        this.cdpUri = null;
        this.ca = null;
        this.pceId = null;
        this.ppid = null;
        this.cpusvn = null;
        this.pcesvn = null;
        this.version = null;
    }
    parseCert(certificate) {
        try {
            const cert = new X509Certificate(certificate);
            const issuer = cert.issuer;
            const extensions = cert.extensions;
            let sgxExtensions = null;
            let cdpExtension = null;

            // X.509 version in ASN.1 is zero-based (v3 => 2).
            this.version = (cert.asn?.tbsCertificate?.version ?? 0) + 1;

            // parse the issuer
            if (issuer.includes('Platform')) {
                this.ca = Constants.CA_PLATFORM;
            } else if (issuer.includes('Processor')) {
                this.ca = Constants.CA_PROCESSOR;
            }

            for (let i = 0; i < extensions.length; i++) {
                if (extensions[i].type === SGX_EXTENSIONS_OID) {
                    sgxExtensions = extensions[i].value;
                } else if (extensions[i].type === X509_EXTENSIONS_CDP_OID) {
                    cdpExtension = extensions[i].value;
                }
            }

            if (sgxExtensions) {
                const parsed = asn1js.fromBER(sgxExtensions);
                if (parsed.offset === -1) {
                    throw new Error('Failed to decode SGX extension DER.');
                }

                const sgxExtValues = parsed.result?.valueBlock?.value || [];
                for (let i = 0; i < sgxExtValues.length; i++) {
                    const obj = sgxExtValues[i];
                    const values = obj?.valueBlock?.value;
                    if (!values || values.length < 2 || values[0]?.idBlock?.tagNumber !== TAG_OID) {
                        continue;
                    }

                    const valueOid = values[0].valueBlock.toString();
                    if (valueOid === SGX_EXTENSIONS_FMSPC_OID) {
                        assignHexField(this, 'fmspc', values[1]);
                    } else if (valueOid === SGX_EXTENSIONS_PCEID_OID) {
                        assignHexField(this, 'pceId', values[1]);
                    } else if (valueOid === SGX_EXTENSIONS_PPID_OID) {
                        assignHexField(this, 'ppid', values[1]);
                    } else if (valueOid === SGX_EXTENSIONS_TCB_OID) {
                        assignTcbFields(this, values[1]);
                    }
                }
            }
            if (cdpExtension) {
                const cdpExtValues = AsnParser.parse(cdpExtension, CRLDistributionPoints);
                this.cdpUri = cdpExtValues?.[0]?.distributionPoint?.fullName?.[0]?.uniformResourceIdentifier || null;
            }

            return true;
        } catch (err) {
            logger.error(`Failed to parse x509 cert : ${err}`);
            return false;
        }
    }
}

export default X509;
