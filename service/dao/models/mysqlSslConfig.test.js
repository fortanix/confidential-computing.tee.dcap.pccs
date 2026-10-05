/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import esmock from 'esmock';
import sinon from 'sinon';
import { expect } from 'chai';

describe('mysqlSslConfig.getSSLConfig - MySQL transport TLS configuration', () => {
    async function loadTarget({ existsSyncReturns = true, readFileSyncError = null } = {}) {
        const logger = {
            error:             sinon.stub(),
            endAndExitProcess: sinon.stub()
        };
        const fsStub = {
            existsSync:   sinon.stub().returns(existsSyncReturns),
            readFileSync: readFileSyncError ?
                sinon.stub().throws(readFileSyncError) :
                sinon.stub().returns(Buffer.from('fake-ca-contents'))
        };
        const target = await esmock('./mysqlSslConfig.js', {
            'fs':                    fsStub,
            '../../utils/Logger.js': { 'default': logger }
        });
        return { target, logger, fsStub };
    }

    it('returns null when no ssl config is provided', async() => {
        const { target } = await loadTarget();
        expect(target.getSSLConfig(undefined)).to.equal(null);
    });

    it('returns null (plaintext, no TLS attempted) when ssl.required is false', async() => {
        const { target, fsStub } = await loadTarget();
        const result = target.getSSLConfig({ required: false, ca: '/path/to/ca.pem' });

        expect(result).to.equal(null);
        expect(fsStub.existsSync.called, 'must not even need to check the CA file when required=false').to.be.false;
    });

    it('returns a dialectOptions.ssl object with the CA contents when required=true and the CA file exists', async() => {
        const { target, fsStub } = await loadTarget({ existsSyncReturns: true });
        const result = target.getSSLConfig({ required: true, ca: '/path/to/ca.pem' });

        expect(result).to.deep.equal({ ssl: { ca: Buffer.from('fake-ca-contents') } });
        expect(fsStub.existsSync.calledWith('/path/to/ca.pem')).to.be.true;
    });

    it('fails closed (logs an error, exits, and throws) instead of silently falling back to plaintext when required=true but the CA file is missing/misconfigured', async() => {
        const { target, logger } = await loadTarget({ existsSyncReturns: false });

        expect(
            () => target.getSSLConfig({ required: true, ca: '/nonexistent/ca.pem' }),
            'must throw so callers cannot proceed with a plaintext connection while the process exit is pending'
        ).to.throw();
        expect(
            logger.error.called,
            'a missing CA file with ssl.required=true must be logged as an error'
        ).to.be.true;
        expect(
            logger.endAndExitProcess.called,
            'a missing CA file with ssl.required=true must stop the process rather than silently connecting over plaintext'
        ).to.be.true;
    });

    it('fails closed with a "not configured" message (not a misleading "not found") when required=true but ssl.ca is missing entirely', async() => {
        const { target, logger, fsStub } = await loadTarget();

        expect(
            () => target.getSSLConfig({ required: true }),
            'must throw when no CA path is configured at all'
        ).to.throw();
        expect(
            logger.error.calledWithMatch(/not configured/),
            'message must say the CA is not configured, not that a file was "not found"'
        ).to.be.true;
        expect(
            fsStub.existsSync.called,
            'must not check the filesystem when no CA path is configured'
        ).to.be.false;
    });

    it('fails closed (logs an error, exits, and throws) instead of propagating a raw fs error when the CA file exists but cannot be read', async() => {
        const { target, logger } = await loadTarget({ existsSyncReturns: true, readFileSyncError: new Error('EACCES: permission denied') });

        expect(
            () => target.getSSLConfig({ required: true, ca: '/path/to/ca.pem' }),
            'must throw so callers cannot proceed with a plaintext connection while the process exit is pending'
        ).to.throw();
        expect(
            logger.error.called,
            'a CA file read failure with ssl.required=true must be logged as an error'
        ).to.be.true;
        expect(
            logger.endAndExitProcess.called,
            'a CA file read failure with ssl.required=true must stop the process rather than silently connecting over plaintext'
        ).to.be.true;
    });

    it('fails closed (logs an error, exits, and throws) instead of propagating a raw fs error when checking whether the CA file exists throws', async() => {
        const logger = {
            error:             sinon.stub(),
            endAndExitProcess: sinon.stub()
        };
        const fsStub = {
            existsSync:   sinon.stub().throws(new Error('ENAMETOOLONG')),
            readFileSync: sinon.stub().returns(Buffer.from('fake-ca-contents'))
        };
        const target = await esmock('./mysqlSslConfig.js', {
            'fs':                    fsStub,
            '../../utils/Logger.js': { 'default': logger }
        });

        expect(
            () => target.getSSLConfig({ required: true, ca: '/path/to/ca.pem' }),
            'must throw so callers cannot proceed with a plaintext connection while the process exit is pending'
        ).to.throw();
        expect(
            logger.error.called,
            'an existsSync failure with ssl.required=true must be logged as an error'
        ).to.be.true;
        expect(
            logger.endAndExitProcess.called,
            'an existsSync failure with ssl.required=true must stop the process rather than silently connecting over plaintext'
        ).to.be.true;
    });
});
