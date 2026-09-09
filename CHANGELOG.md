# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-07-01

### Added

- **AWS Step Functions orchestration.** The encode workflow is now an explicit Standard
  state machine with one execution per uploaded video: Probe the source, select a quality
  tier, run the MediaConvert job with the `createJob.sync` integration, record the job, and
  publish an SNS notification. Replaces the previous event-chained `job-submit` +
  EventBridge + `job-complete` Lambdas — v2 has no Lambda in the encode workflow at all.
- **Source-aware tier selection.** A MediaConvert Probe step reads the source resolution and
  a `Choice` state selects an SD, HD (default), or UHD job template.
- **Best-practice MediaConvert job templates.** Three CDK-managed `AWS::MediaConvert::JobTemplate`
  resources (SD/HD/UHD) using CMAF (fragmented MP4, served as HLS and DASH) with QVBR and Auto
  ABR. SD and HD encode with H.264/AVC; UHD encodes with HEVC/H.265 (`H_265`/`H265Settings`,
  QVBR, Multi-pass HQ, 2s GOP) for better compression efficiency at 4K.
- **DynamoDB job table.** Completed jobs are recorded as one item per job (partition key `Guid`)
  via the native Step Functions `dynamodb:putItem` integration — no completion Lambda. Each item
  captures the probe output, MediaConvert job result, output manifest names (`.m3u8`/`.mpd`),
  CloudFront playback URLs, and the output S3 location. A `Status`-`Timestamp` GSI supports
  listing jobs by status.
- Centralized error handling via a top-level `Catch` to SNS, `Retry` with backoff on transient
  MediaConvert errors, a dead-letter queue on the EventBridge trigger, Step Functions execution
  logging (ALL) with X-Ray tracing, and a CloudWatch alarm on failed executions.
- **Serverless-hardening (Well-Architected Serverless Lens):** per-task `TimeoutSeconds` on
  every state; CloudWatch alarms on `ExecutionsTimedOut`, `ExecutionThrottled`,
  `ExecutionsAborted`, and trigger-DLQ depth; an EventBridge Archive (30-day) for event replay;
  and DynamoDB TTL (`ExpiresAt`, 90 days) so job records self-expire. (Execution idempotency
  under at-least-once delivery was evaluated and deferred as an accepted residual risk, with a
  planned DynamoDB conditional-write fix.)

### Changed

- **BREAKING: per-prefix `job-settings.json` overrides are no longer supported.** Uploading a
  video now probes the source and automatically applies the matching SD/HD/UHD Auto ABR job
  template. Advanced users customize by editing a tier job template
  (`source/cdk/lib/job-templates/{sd,hd,uhd}.json`) instead of supplying a settings file.
- **BREAKING: job status is now in DynamoDB, not `jobs-manifest.json`.** The single
  `jobs-manifest.json` object in the source bucket has been replaced by a DynamoDB table. This
  removes a read-modify-write race that could drop records under concurrent uploads. Consumers
  that scraped the manifest object must query the table instead.
- **Anonymized deployment tracking is now provided solely by the `(SO9673)` Solution ID in the
  CloudFormation template description** (harvested automatically on deploy), replacing both the
  previous per-completed-job metric send and the custom-resource metrics POST.
- Refreshed `aws-cdk-lib`, `aws-cdk`, the AWS Solutions Constructs, and `cdk-nag`; migrated the
  CDK test off the deprecated `@aws-cdk/assert` to `aws-cdk-lib/assertions`. (With no
  solution-authored Lambdas remaining, the solution no longer manages any function runtime; the
  only function in the stack is the CDK-managed S3 bucket-notifications handler.)

### Removed

- The `job-submit` Lambda (its work is now the ASL request assembly plus the `createJob.sync`
  task) and the MediaConvert-to-EventBridge-to-Lambda completion path.
- The `job-complete` Lambda. Playback-URL assembly is now done in ASL with `States.Format`, and
  job recording is the native `dynamodb:putItem` task.
- The `jobs-manifest.json` object and its seeding (job status now lives in DynamoDB).
- **The `custom-resource` Lambda entirely.** The MediaConvert account-endpoint lookup is no
  longer needed (the native `createJob.sync` integration uses the default endpoint), the metrics
  UUID is obsolete (deployment tracking is via the Solution ID), and there is nothing left to
  seed. The stack now has **no solution-authored Lambdas** — the only remaining function is the
  CDK-managed S3 bucket-notifications handler.
- The seeded default `assets01/job-settings.json` and the per-suffix S3 bucket notification
  configuration (replaced by an S3 EventBridge rule that starts the state machine).

### Fixed

- **720p sources were encoded with the SD template instead of HD.** The `Choose Tier` Choice
  used `NumericLessThanEquals: 720` for the SD branch, so a 1280×720 (720p) source — which is
  HD, not SD — matched SD and got the lower-bitrate/fewer-rendition ladder. Changed the
  boundary to `NumericLessThan: 720` so SD is strictly below 720 (480/576), and 720p/1080p
  fall through to the HD default; 1440p and above remain UHD.
- **Audio-first sources were wrongly rejected as "Unsupported Source."** The `Validate File
  Type` and `Choose Tier` Choice states read the source height from a fixed
  `...Tracks[0].VideoProperties.Height` path, but the MediaConvert Probe API does not
  guarantee the video track is first — containers that list an audio track at index 0 (e.g.
  some recorded MP4s) put video at a later index, so a valid video was mis-detected as having
  no video track and the workflow failed within ~1s. A new `Extract Video Metadata` step now
  selects the track whose `TrackType` is `video` (via JSONata) and normalizes its height into
  `$.videoHeight`; both Choice states key off that field, so tier selection and validation are
  correct regardless of track order.

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
