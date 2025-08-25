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
import express from 'express';
const expressRouter = express.Router;
import Config from 'config';
import body_parser from 'body-parser';
import {
    platformsController,
    platformCollateralController,
    pckcertController,
    pckcrlController,
    tcbinfoController,
    identityController,
    rootcacrlController,
    refreshController,
    crlController,
    appraisalPolicyController,
    healthController,
    versionController,
} from '../controllers/index.js';
import * as auth from '../middleware/auth.js';

// strict: true disables the implicit optional trailing slash (e.g. "/platforms/" no longer matches "/platforms")
const sgxRouter = expressRouter({ strict: true });
const tdxRouter = expressRouter({ strict: true });
const healthRouter = expressRouter({ strict: true });

// parse body only after auth, and only on routes that actually read req.body
// if you add a new route here with ...parseBody, also add it to BODY_ALLOWED_ENDPOINTS in middleware/rejectUnexpectedBody.js
const maxRequestBodySize = Config.has('MaxRequestBodySize') ? Config.get('MaxRequestBodySize') : '2MB';
const parseBody = [
    body_parser.urlencoded({ extended: true, limit: maxRequestBodySize }),
    body_parser.json({ limit: maxRequestBodySize })
];

//---------------- Routes for SGX APIs-------------------------------
sgxRouter
    .route('/platforms')
    .post(auth.validateUser, ...parseBody, platformsController.postPlatforms)
    .get(auth.validateAdmin, platformsController.getPlatforms);

sgxRouter
    .route('/platformcollateral')
    .put(auth.validateAdmin, ...parseBody, platformCollateralController.putPlatformCollateral);

sgxRouter.route('/pckcert').get(pckcertController.getPckCert);

sgxRouter.route('/pckcrl').get(pckcrlController.getPckCrl);

sgxRouter.route('/tcb').get(tcbinfoController.getSgxTcbInfo);

sgxRouter.route('/qe/identity').get(identityController.getEcdsaQeIdentity);

sgxRouter.route('/qve/identity').get(identityController.getQveIdentity);

sgxRouter.route('/rootcacrl').get(rootcacrlController.getRootCaCrl);

sgxRouter.route('/crl').get(crlController.getCrl);

sgxRouter.route('/version').get(versionController.getVersion);

sgxRouter
    .route('/refresh')
    .post(auth.validateAdmin, refreshController.refreshCache)
    .get(auth.validateAdmin, refreshController.refreshCache);

sgxRouter
    .route('/appraisalpolicy')
    .put(auth.validateAdmin, ...parseBody, appraisalPolicyController.putAppraisalPolicy)
    .get(appraisalPolicyController.getAppraisalPolicy);

//---------------- Routes for TDX APIs-------------------------------
tdxRouter.route('/tcb').get(tcbinfoController.getTdxTcbInfo);

tdxRouter.route('/qe/identity').get(identityController.getTdQeIdentity);

//---------------- Routes for health probes--------------------------
healthRouter.route('/live').get(healthController.getLiveness);

healthRouter.route('/ready').get(healthController.getReadiness);

healthRouter.route('/startup').get(healthController.getStartup);

export { sgxRouter, tdxRouter, healthRouter };
