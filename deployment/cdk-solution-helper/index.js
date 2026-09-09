/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

// Imports
const fs = require('fs');
const _regex = /[\w]*AssetParameters/g; //this regular express also takes into account lambda functions defined in nested stacks

// Build context mapping from command line arguments.
//
// Example:
//   --name value --anothername anothervalue
//
// The example will produce an object that looks like:
//   { "name": "value", "anothername": "anothervalue" }
//
// The script looks for the following names:
//  * solution_name
//  * solution_version
//  * bucket_name
const contextMap = (function () {
  const commandLineArgs = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < commandLineArgs.length - 1; ++i) {
    const arg = commandLineArgs[i];
    if (arg.startsWith('--')) {
      const name = arg.substr(2);
      const value = commandLineArgs[++i];
      result[name] = value;
    }
  }
  return result;
}());

// Paths
const global_s3_assets = '../global-s3-assets';

const getAllAssetParameterKeys = (parameters) =>
    Object.keys(parameters).filter((key) => key.search(_regex) > -1);

// For each template in global_s3_assets ...
//
// NOTE (v2): this solution has NO solution-authored Lambda functions — every
// workflow step is a native Step Functions service integration, and the only
// AWS::Lambda::Function in the template is the CDK-managed S3 bucket-notifications
// handler, which carries inline (ZipFile) code, not an S3-backed asset. As a
// result there are normally no asset-backed Lambdas and no *AssetParameters to
// rewrite, and this helper is a no-op. The rewrite logic below is retained
// (guarded) so the build still works correctly if an asset-backed Lambda is ever
// reintroduced.
fs.readdirSync(global_s3_assets).forEach((file) => {
    // Import and parse template file
    const raw_template = fs.readFileSync(`${global_s3_assets}/${file}`);
    let template = JSON.parse(raw_template);
    let modified = false;

    // Rewrite any asset-backed Lambda code to the S3 distribution location.
    const resources = template.Resources ? template.Resources : {};
    const assetBackedFunctions = Object.keys(resources).filter((key) =>
        resources[key].Type === 'AWS::Lambda::Function' &&
        resources[key].Properties.Code &&
        resources[key].Properties.Code.hasOwnProperty('S3Bucket'));

    assetBackedFunctions.forEach(function (f) {
        const fn = resources[f];
        // Set the S3 key reference
        let artifactHash = Object.assign(fn.Properties.Code.S3Key);
        artifactHash = artifactHash.replace(_regex, '');
        artifactHash = artifactHash.substring(0, artifactHash.indexOf('.zip'));
        const assetPath = `asset${artifactHash}`;
        fn.Properties.Code.S3Key = `${contextMap.solution_name}/${contextMap.solution_version}/${assetPath}.zip`;
        // Set the S3 bucket reference
        fn.Properties.Code.S3Bucket = {
            'Fn::Sub': [contextMap.bucket_name, '${AWS::Region}'].join('-'),
        };
        // Set the handler
        const handler = fn.Properties.Handler;
        fn.Properties.Handler = `${assetPath}/${handler}`;
        modified = true;
    });

    // Remove any CDK-generated *AssetParameters from the Parameters section.
    const parameters = template.Parameters ? template.Parameters : {};
    const assetParameters = getAllAssetParameterKeys(parameters);
    assetParameters.forEach(function (a) {
        template.Parameters[a] = undefined;
        modified = true;
    });

    if (!modified) {
        console.log(`cdk-solution-helper: ${file} has no asset-backed Lambda code ` +
            `or AssetParameters to rewrite (v2 uses native integrations / inline code); ` +
            `leaving template unchanged.`);
        return;
    }

    // Output modified template file
    const output_template = JSON.stringify(template, null, 2);
    fs.writeFileSync(`${global_s3_assets}/${file}`, output_template);
    console.log(`cdk-solution-helper: rewrote ${assetBackedFunctions.length} asset-backed ` +
        `Lambda function(s) and removed ${assetParameters.length} AssetParameter(s) in ${file}.`);
});
