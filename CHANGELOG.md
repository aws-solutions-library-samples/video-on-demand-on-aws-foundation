# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.13] - 2026-03-25

### Security

- Security updates for npm packages

## [1.3.12] - 2026-03-04

### Changed

- Renamed from "Video on Demand on AWS Foundation" solution to "Guidance for Video on Demand on AWS Foundation"

## [1.3.11] - 2025-09-23

### Removed

- Removed log line

### Security

- Updated npm packages

## [1.3.10] - 2025-08-26

### Removed

- AppRegistry removed from solution
	  
### Security
	  
- Security updates for npm packages

## [1.3.9] - 2025-06-19

### Changed

- Updated Lambdas to NodeJS 22

### Fixed

- Resolved permission issue with JobSubmit lambda

### Security

- Security updates for npm packages

## [1.3.8] - 2025-03-14

### Security

- Security updates for npm packages

## [1.3.7] - 2024-11-21

### Security

- Security updates for npm packages

## [1.3.6] - 2024-09-17

### Security

- Security updates for npm packages

## [1.3.5] - 2024-08-22

### Security

- Security updates for npm packages

## [1.3.4] - 2024-08-09

### Security

- Upgraded vulnerable packages

## [1.3.3] - 2024-07-19

### Security

- Security updates for transitive dependencies

## [1.3.2] - 2023-11-02

### Security

- Security updates for transitive dependencies

## [1.3.1] - 2023-09-29

### Added

- Enabled logging for JobSubmit and JobComplete Lambdas

### Changed

- Updated Lambdas to NodeJS 18 and JavaScript AWS SDK v3
- Updated packages
- Removed deprecated moment package

### Fixed

- cdk snapshot test

## [1.3.0] - 2023-06-01

### Added

- cdk-nag rule suppressions
- Updated deployment/build-s3-dist.sh to output cdk nag errors
- Added CloudWatch logs permissions to CustomResource component in cdk

### Changed

- Upgraded to cdk v2
- Added region name and account ID to AppRegistry Application name
- Changed AppRegistry Attribute Group name to Region-StackName
- Updated AppRegistry attribute and tag names
- Upgraded Lambda runtimes to node 16
- Removed application insights
- Use logs bucket for cloudfront distribution logging

## [1.2.1] - 2023-04-17

### Changed

- Updated object ownership configuration on Logs bucket and CloudFront Logging bucket

## [1.2.0] - 2022-10-17

### Added

- AppRegistry Application Stack Association
- Application Insights in AppRegistry
- SonarQube properties file: sonar-project.properties
- Added unit tests with 80% code coverage

### Changed

- Changed deployment/run-unit-tests.sh to generate unit test coverage reports

## [1.1.0] - 2021-07-29

### Added

- Added new input file extensions wmv, mxf, mkv, m3u8, mpeg, webm, and h264.
- All file extensions now work in uppercase or lowercase format. Example WMV and wmv now trigger jobs via S3. (<https://github.com/awslabs/video-on-demand-on-aws-foundations/issues/8>)

### Changed

- New MediaConvert job-settings.json template removing DASH and MP4 renditions to reduce cost.
  - Pricing savings of 37% by changing default job-settings.json from Professional tier to Basic tier.
  - Deinterlacer setting turned off in job-settings.json so AWS MediaConvert uses Basic Tier and not Professional tier.
  - Default job-settings.json frames per second set to follow source now instead of setting a strict 30 fps.

### Fixed

- Readme file updates. (<https://github.com/awslabs/video-on-demand-on-aws-foundations/issues/12>)
- Added mock settings for unit tests. (<https://github.com/awslabs/video-on-demand-on-aws-foundations/issues/6>)
- Added extra steps when building in the Readme file. (<https://github.com/awslabs/video-on-demand-on-aws-foundations/issues/4>)
- Updated Axios to version 0.21.1

## [1.0.0] - 2020-11-05

### Added

- All files, initial version
