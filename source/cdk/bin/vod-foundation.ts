#!/usr/bin/env node

/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DefaultStackSynthesizer } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { VodFoundation } from '../lib/vod-foundation-stack';
import { version as pkgVersion } from '../package.json';

function createVodFoundationApp(app: cdk.App) {
  return new VodFoundation(app, 'VodFoundation', {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false
    })
  });
}

const app = new cdk.App();

/**
 * Solution version for the CloudFormation template description. package.json is the single
 * source of truth, so `npx cdk deploy` works with no flags. Normalize to the `vX.Y.Z` form
 * used in the description. A `-c solution_version=...` override (or the build pipeline's
 * --context) still takes precedence because it is set before this runs.
 */
if (!app.node.tryGetContext('solution_version')) {
  const solutionVersion = pkgVersion.startsWith('v') ? pkgVersion : `v${pkgVersion}`;
  app.node.setContext('solution_version', solutionVersion);
}

createVodFoundationApp(app);

//cdk nag
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
