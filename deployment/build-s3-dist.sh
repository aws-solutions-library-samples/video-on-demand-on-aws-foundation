#!/bin/bash
#
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
#
# This script builds the deployable distributable for the Guidance:
#   1. Remove any old dist files from previous runs.
#   2. Build and synthesize the CDK project into a staging folder.
#   3. Run the cdk-solution-helper post-processor and place the single
#      CloudFormation template in the /global-s3-assets folder.
#   4. Remove any temporary files used for staging.
#
# NOTE (v2): the encode workflow uses native Step Functions integrations and has
# NO solution-authored Lambda functions, so there is no Lambda code to package.
# The build therefore produces only the CloudFormation template in
# /global-s3-assets; /regional-s3-assets is created for the AWS Solutions publish
# pipeline but stays empty by design.
#
# This script should be run from the repo's deployment directory
# cd deployment
# ./build-s3-dist.sh source-bucket-base-name [solution-name [version-code]]
#
# Parameters:
#  - source-bucket-base-name: Base name for the S3 bucket location used by the
#    AWS Solutions distribution convention. The template appends '-[region_name]'.
#    For example: ./build-s3-dist.sh solutions my-solution v1.2.0
#  - solution-name: name of the solution for consistency
#  - version-code: version of the package (semantic version, e.g. v2.0.0)
[ "$DEBUG" == 'true' ] && set -x
set -e

# Check to see if input has been provided:
if [ -z "$1" ]; then
    echo "Please provide all required parameters for the build script"
    echo "For example: ./build-s3-dist.sh solutions trademarked-solution-name v1.2.0"
    exit 1
fi

# set the PWD to the directory containing this script so we can run
# the script from anywhere and the relative paths below still work.
cd "$(dirname "${BASH_SOURCE[0]}")"

# Get reference for all important folders
declare -r template_dir="$PWD"
declare -r staging_dist_dir="$template_dir/staging"
declare -r template_dist_dir="$template_dir/global-s3-assets"
declare -r build_dist_dir="$template_dir/regional-s3-assets"
declare -r source_dir="$template_dir/../source"

declare -r bucket_name="$1"
declare -r solution_name="${2:-video-on-demand-on-aws-foundation}"

# Check if the version argument is a valid version (semantic version-like).
# Example:
#   v21.13.5-develop
#   ^       ^^^^^^^^
#    \         /
#      optional
if [[ "${3:-undefined}" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-.*)?$ ]]
then
  # It matches the pattern so use it as-is.
  declare -r semantic_version="${3}"
else
  # The version string didn't match the pattern so extract the
  # version from the CDK package.json so we have a valid version.
  declare -r semantic_version=v$(cat "$source_dir/cdk/package.json" \
    | tr -d ' \r\n\t' \
    | grep -om1 '"version":"[^"]*"' \
    | cut -d '"' -f4 \
    | sed -e 's/^v//')
fi
# Use the validated version resolved above (the arg if it was a valid semantic
# version, otherwise the version extracted from package.json). This is the single
# source of truth passed to BOTH the synth context and the cdk-solution-helper,
# so the template description and the packaged artifacts never diverge.
declare -r solution_version="${semantic_version}"


echo "------------------------------------------------------------------------------"
echo "[Init] Remove any old dist files from previous runs"
echo "------------------------------------------------------------------------------"
rm -rf "$template_dist_dir"
mkdir -p "$template_dist_dir"

# v2 has no solution-authored Lambda assets, so this directory stays empty;
# it is created because the AWS Solutions publish pipeline expects it to exist.
rm -rf "$build_dist_dir"
mkdir -p "$build_dist_dir"

rm -rf "$staging_dist_dir"
mkdir -p "$staging_dist_dir"

echo "------------------------------------------------------------------------------"
echo "[Synth] CDK Project"
echo "------------------------------------------------------------------------------"

cd "$source_dir/cdk"
npm install

npm run cdk -- context --clear
npm run synth -- --output="$staging_dist_dir" \
  --context "solution_version=${solution_version}"

if [ $? -ne 0 ]
then
    echo "******************************************************************************"
    echo "cdk-nag found errors"
    echo "******************************************************************************"
    exit 1
fi

cd "$staging_dist_dir"
rm -f tree.json manifest.json cdk.out

echo "------------------------------------------------------------------------------"
echo "Run Cdk Helper"
echo "------------------------------------------------------------------------------"
mv VodFoundation.template.json "$template_dist_dir/video-on-demand-on-aws-foundation.template"

node "$template_dir/cdk-solution-helper/index" \
  --bucket_name "${bucket_name}" \
  --solution_name "${solution_name}" \
  --solution_version "${solution_version}"

# NOTE (v2): there is no "[Packing] source code artifacts" step. The stack has no
# solution-authored Lambda functions, so a clean synth produces no asset.* folders
# to zip into /regional-s3-assets. If a future change reintroduces an asset-backed
# Lambda, restore an asset-packaging loop here and the S3-code rewrite in
# cdk-solution-helper/index.js.

echo "------------------------------------------------------------------------------"
echo "[Cleanup] Remove temporary files"
echo "------------------------------------------------------------------------------"
rm -rf "$staging_dist_dir"
