/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import { expect } from 'chai';
import sinon from 'sinon';
import X509 from './x509.js';
import Constants from '../constants/index.js';
import logger from '../utils/Logger.js';

const PCK_CERT_V2 = '-----BEGIN CERTIFICATE-----\nMIIEcDCCBBegAwIBAgIVAIIkZD86jNCNJbZWlp37r1jl0+M+MAoGCCqGSM49BAMC\nMHExIzAhBgNVBAMMGkludGVsIFNHWCBQQ0sgUHJvY2Vzc29yIENBMRowGAYDVQQK\nDBFJbnRlbCBDb3Jwb3JhdGlvbjEUMBIGA1UEBwwLU2FudGEgQ2xhcmExCzAJBgNV\nBAgMAkNBMQswCQYDVQQGEwJVUzAeFw0yNjAxMTMxMjA4MzFaFw0zMzAxMTMxMjA4\nMzFaMHAxIjAgBgNVBAMMGUludGVsIFNHWCBQQ0sgQ2VydGlmaWNhdGUxGjAYBgNV\nBAoMEUludGVsIENvcnBvcmF0aW9uMRQwEgYDVQQHDAtTYW50YSBDbGFyYTELMAkG\nA1UECAwCQ0ExCzAJBgNVBAYTAlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\nIzQCvlfIxC7Yq0/BxGOLtGOxj3GlntXMaGRwBYnpdB1l6xCATaX+F0XSon0ITMIj\ndxzCi6do/F3t4iBsHEUQ+qOCAoswggKHMB8GA1UdIwQYMBaAFJ8Gl+9TIUTU+kx+\n6LqNs9Ml5JKQMFAGA1UdHwRJMEcwRaBDoEGGP2h0dHBzOi8vMTI3LjAuMC4xOjg0\nNDQvc2d4L2NlcnRpZmljYXRpb24vdjIvcGNrY3JsP2NhPXByb2Nlc3NvcjAdBgNV\nHQ4EFgQUUIUEl6vC8wYkn79H6MkSbEJtbs0wDgYDVR0PAQH/BAQDAgbAMAwGA1Ud\nEwEB/wQCMAAwggHTBgkqhkiG+E0BDQEEggHEMIIBwDAeBgoqhkiG+E0BDQEBBBAc\nfZDkNWx5KO7SMLMO6UPvMIIBYwYKKoZIhvhNAQ0BAjCCAVMwEAYLKoZIhvhNAQ0B\nAgECAQQwEAYLKoZIhvhNAQ0BAgICAQQwEAYLKoZIhvhNAQ0BAgMCAQIwEAYLKoZI\nhvhNAQ0BAgQCAQIwEAYLKoZIhvhNAQ0BAgUCAQQwEAYLKoZIhvhNAQ0BAgYCAQEw\nEAYLKoZIhvhNAQ0BAgcCAQAwEAYLKoZIhvhNAQ0BAggCAQcwEAYLKoZIhvhNAQ0B\nAgkCAQAwEAYLKoZIhvhNAQ0BAgoCAQAwEAYLKoZIhvhNAQ0BAgsCAQAwEAYLKoZI\nhvhNAQ0BAgwCAQAwEAYLKoZIhvhNAQ0BAg0CAQAwEAYLKoZIhvhNAQ0BAg4CAQAw\nEAYLKoZIhvhNAQ0BAg8CAQAwEAYLKoZIhvhNAQ0BAhACAQAwEAYLKoZIhvhNAQ0B\nAhECAQswHwYLKoZIhvhNAQ0BAhIEEAQEAgIEAQAHAAAAAAAAAAAwEAYKKoZIhvhN\nAQ0BAwQCAAAwFAYKKoZIhvhNAQ0BBAQGEjRWeAAAMA8GCiqGSIb4TQENAQUKAQAw\nCgYIKoZIzj0EAwIDRwAwRAIgMxY73Uo21qn8Wef740y40AJEGDyuN3qMsh+nUkDz\nszYCIFqWeP0OeW8IJYhxvUSRMs5377DpEA7OJ4DR3+0Smoic\n-----END CERTIFICATE-----\n';
const PCK_CERT_V4 = '-----BEGIN CERTIFICATE-----\nMIIEfTCCBCSgAwIBAgIVAI1TRrwN0ZjGEM3jgRQDcVj+rXEUMAoGCCqGSM49BAMC\nMHExIzAhBgNVBAMMGkludGVsIFNHWCBQQ0sgUHJvY2Vzc29yIENBMRowGAYDVQQK\nDBFJbnRlbCBDb3Jwb3JhdGlvbjEUMBIGA1UEBwwLU2FudGEgQ2xhcmExCzAJBgNV\nBAgMAkNBMQswCQYDVQQGEwJVUzAeFw0yNjAxMTUxMzA3MzdaFw0zMzAxMTUxMzA3\nMzdaMHAxIjAgBgNVBAMMGUludGVsIFNHWCBQQ0sgQ2VydGlmaWNhdGUxGjAYBgNV\nBAoMEUludGVsIENvcnBvcmF0aW9uMRQwEgYDVQQHDAtTYW50YSBDbGFyYTELMAkG\nA1UECAwCQ0ExCzAJBgNVBAYTAlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\nK2ikxsQM5yphyseHh996DOAdt9D+lS7+oqOKg5DfNefy3YupVL5JFZCM6QMwq0Qm\nOx+7uxouW8jomsFQRGspqaOCApgwggKUMB8GA1UdIwQYMBaAFJ8Gl+9TIUTU+kx+\n6LqNs9Ml5JKQMF0GA1UdHwRWMFQwUqBQoE6GTGh0dHBzOi8vMTI3LjAuMC4xOjg0\nNDQvc2d4L2NlcnRpZmljYXRpb24vdjQvcGNrY3JsP2NhPXByb2Nlc3NvciZlbmNv\nZGluZz1kZXIwHQYDVR0OBBYEFLio9qeCU7ySVPEhTvemQ65J711jMA4GA1UdDwEB\n/wQEAwIGwDAMBgNVHRMBAf8EAjAAMIIB0wYJKoZIhvhNAQ0BBIIBxDCCAcAwHgYK\nKoZIhvhNAQ0BAQQQHH2Q5DVseSju0jCzDulD7zCCAWMGCiqGSIb4TQENAQIwggFT\nMBAGCyqGSIb4TQENAQIBAgECMBAGCyqGSIb4TQENAQICAgECMBAGCyqGSIb4TQEN\nAQIDAgECMBAGCyqGSIb4TQENAQIEAgECMBAGCyqGSIb4TQENAQIFAgEDMBAGCyqG\nSIb4TQENAQIGAgEBMBAGCyqGSIb4TQENAQIHAgEAMBAGCyqGSIb4TQENAQIIAgED\nMBAGCyqGSIb4TQENAQIJAgEAMBAGCyqGSIb4TQENAQIKAgEAMBAGCyqGSIb4TQEN\nAQILAgEAMBAGCyqGSIb4TQENAQIMAgEAMBAGCyqGSIb4TQENAQINAgEAMBAGCyqG\nSIb4TQENAQIOAgEAMBAGCyqGSIb4TQENAQIPAgEAMBAGCyqGSIb4TQENAQIQAgEP\nMBAGCyqGSIb4TQENAQIRAgEBMB8GCyqGSIb4TQENAQISBBACAgICAwEAAwAAAAAA\nAAAPMBAGCiqGSIb4TQENAQMEAgAAMBQGCiqGSIb4TQENAQQEBhI0VngAADAPBgoq\nhkiG+E0BDQEFCgEAMAoGCCqGSM49BAMCA0cAMEQCIEOSGXBqLTKvN6IFXFnQdxKs\n22XbZDxNcwpRtYqCTvD8AiA57tu7HNrYec/HqliESl8DuTFlsrOmHp/GvfFsL8b8\nfw==\n-----END CERTIFICATE-----';

describe('x509', () => {
    describe('parseCert', () => {
        afterEach(() => {
            sinon.restore();
        });

        it('should parse SGX fields and CDP URL from a valid V2 certificate', () => {
            const cert = new X509();

            const parsed = cert.parseCert(PCK_CERT_V2);

            expect(parsed).to.equal(true);
            expect(cert.version).to.equal(Constants.PCK_CERT_VERSION);
            expect(cert.ca).to.equal(Constants.CA_PROCESSOR);
            expect(cert.fmspc).to.equal('123456780000');
            expect(cert.pceId).to.equal('0000');
            expect(cert.cpusvn).to.equal('04040202040100070000000000000000');
            expect(cert.pcesvn).to.equal(11);
            expect(cert.ppid).to.equal('1C7D90E4356C7928EED230B30EE943EF');
            expect(cert.cdpUri).to.equal('https://127.0.0.1:8444/sgx/certification/v2/pckcrl?ca=processor');
        });

        it('should parse SGX fields and CDP URL from a valid V4 certificate', () => {
            const cert = new X509();

            const parsed = cert.parseCert(PCK_CERT_V4);

            expect(parsed).to.equal(true);
            expect(cert.version).to.equal(Constants.PCK_CERT_VERSION);
            expect(cert.ca).to.equal(Constants.CA_PROCESSOR);
            expect(cert.fmspc).to.equal('123456780000');
            expect(cert.pceId).to.equal('0000');
            expect(cert.ppid).to.equal('1C7D90E4356C7928EED230B30EE943EF');
            expect(cert.cpusvn).to.equal('0202020203010003000000000000000F');
            expect(cert.pcesvn).to.equal(1);
            expect(cert.cdpUri).to.equal('https://127.0.0.1:8444/sgx/certification/v4/pckcrl?ca=processor&encoding=der');
        });

        it('should return false and log error for invalid certificate data', () => {
            const cert = new X509();
            const logStub = sinon.stub(logger, 'error');

            const parsed = cert.parseCert('not-a-certificate');

            expect(parsed).to.equal(false);
            expect(logStub.calledOnce).to.equal(true);
            expect(logStub.firstCall.args[0]).to.include('Failed to parse x509 cert');
        });
    });
});
