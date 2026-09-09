#!/bin/bash
#
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

[ "$DEBUG" == 'true' ] && set -x
set -e

prepare_jest_coverage_report() {
  local component_name=$1

  if [ ! -d "coverage" ]; then
      echo "ValidationError: Missing required directory coverage after running unit tests"
      exit 129
  fi

  # prepare coverage reports
  rm -fr coverage/lcov-report
  mkdir -p $coverage_reports_top_path/jest
  coverage_report_path=$coverage_reports_top_path/jest/$component_name
  rm -fr $coverage_report_path
  mv coverage $coverage_report_path
}

run_javascript_test() {
  local component_path=$1
  local component_name=$2

  echo "------------------------------------------------------------------------------"
  echo "[Test] Run javascript unit test with coverage for $component_name"
  echo "------------------------------------------------------------------------------"
  echo "cd $component_path"
  cd $component_path

  # install dependencies from the committed lock file (fails if package.json and
  # package-lock.json are out of sync — deterministic, verified installs for CI)
  npm ci --silent
  # run unit tests
  npm test

  

  # prepare coverage reports
  prepare_jest_coverage_report $component_name
}

# Get reference for all important folders
template_dir="$PWD"
source_dir="$template_dir/../source"
coverage_reports_top_path=$source_dir/test/coverage-reports

# Packages to unit test. v2 has no solution-authored Lambda functions, so the only
# component with tests is the CDK application (source/cdk).
declare -a component_packages=(
  "cdk"
)

for component_package in "${component_packages[@]}"
do
  rm -rf $source_dir/$component_package/coverage
  mkdir $source_dir/$component_package/coverage
  run_javascript_test $source_dir/$component_package $component_package

  # Check the result of the test and exit if a failure is identified
  if [ $? -eq 0 ]
  then
    echo "Test for $component_package passed"
  else
    echo "******************************************************************************"
    echo "Test FAILED for $component_package"
    echo "******************************************************************************"
    exit 1
  fi

done