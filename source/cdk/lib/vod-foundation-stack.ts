/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as mediaconvert from 'aws-cdk-lib/aws-mediaconvert';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { HttpMethods } from 'aws-cdk-lib/aws-s3';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';
/**
 * AWS Solution Constructs: https://docs.aws.amazon.com/solutions/latest/constructs/
 */
import { CloudFrontToS3 } from '@aws-solutions-constructs/aws-cloudfront-s3';


export class VodFoundation extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        /**
         * CloudFormation Template Descrption
         */
        const solutionId = 'SO9673'
        const solutionName = 'Video on Demand on AWS Foundation'
        const solutionVersion = scope.node.tryGetContext('solution_version');
        this.templateOptions.description = `(${solutionId}) ${solutionName} Solution Implementation. Version ${solutionVersion}`;
        /**
         * Anonymized deployment tracking for this Guidance is provided by the Solution ID in the
         * CloudFormation template description above (harvested automatically on deploy) — no
         * custom resource or metrics endpoint call is required.
         */
        /**
         * Admin email for SNS job-status notifications. Supplied as a CDK context value
         * (`-c email=you@example.com`, or set once in cdk.json) and validated here at synth
         * time — this fails fast with a clear message rather than at deploy time.
         */
        const adminEmail = scope.node.tryGetContext('email');
        // Linear-time email validation: each character class is disjoint and the pattern has no
        // nested/overlapping quantifiers, so it is not susceptible to catastrophic backtracking (ReDoS).
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!adminEmail || !emailPattern.test(adminEmail)) {
            throw new Error(
                'A valid admin email is required. Provide it as a CDK context value, e.g. ' +
                '`cdk deploy -c email=you@example.com` (or set "email" in cdk.json). ' +
                'This address receives the SNS job-status notifications.'
            );
        }
        /**
         * Logs bucket for S3 and CloudFront
        */
        const logsBucket = new s3.Bucket(this, 'Logs', {
            encryption: s3.BucketEncryption.S3_MANAGED,
            publicReadAccess: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
            enforceSSL: true,
            versioned: true
        });
        /**
         * Get Cfn Resource for the logs bucket and add CFN_NAG rule
         */
        const cfnLogsBucket = logsBucket.node.findChild('Resource') as s3.CfnBucket;
        cfnLogsBucket.cfnOptions.metadata = {
            cfn_nag: {
                rules_to_suppress: [{
                    id: 'W35',
                    reason: 'Logs bucket does not require logging configuration'
                }, {
                    id: 'W51',
                    reason: 'Logs bucket is private and does not require a bucket policy'
                }]
            }
        };
        //cdk_nag
        NagSuppressions.addResourceSuppressions(
            logsBucket,
            [
                {
                    id: 'AwsSolutions-S1', //same as cfn_nag rule W35
                    reason: 'Used to store access logs for other buckets'
                }, {
                    id: 'AwsSolutions-S10',
                    reason: 'Bucket is private and is not using HTTP'
                }
            ]
        );
        /**
         * Source S3 bucket to host source videos and jobSettings JSON files
        */
        const source = new s3.Bucket(this, 'Source', {
            serverAccessLogsBucket: logsBucket,
            serverAccessLogsPrefix: 'source-bucket-logs/',
            encryption: s3.BucketEncryption.S3_MANAGED,
            publicReadAccess: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            versioned: true
        });
        const cfnSource = source.node.findChild('Resource') as s3.CfnBucket;
        cfnSource.cfnOptions.metadata = {
            cfn_nag: {
                rules_to_suppress: [{
                    id: 'W51',
                    reason: 'source bucket is private and does not require a bucket policy'
                }]
            }
        };
        //cdk_nag
        NagSuppressions.addResourceSuppressions(
            source,
            [
                {
                    id: 'AwsSolutions-S10',
                    reason: 'Bucket is private and is not using HTTP'
                }
            ]
        );
        /**
         * Destination S3 bucket to host the mediaconvert outputs
        */
        const destination = new s3.Bucket(this, 'Destination', {
            serverAccessLogsBucket: logsBucket,
            serverAccessLogsPrefix: 'destination-bucket-logs/',
            encryption: s3.BucketEncryption.S3_MANAGED,
            publicReadAccess: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            cors: [
                {
                    maxAge: 3000,
                    allowedOrigins: ['*'],
                    allowedHeaders: ['*'],
                    allowedMethods: [HttpMethods.GET]
                },
            ],
            enforceSSL: true,
            versioned: true
        });
        //cdk_nag
        NagSuppressions.addResourceSuppressions(
            destination,
            [
                {
                    id: 'AwsSolutions-S10',
                    reason: 'Bucket is private and is not using HTTP'
                }
            ]
        );
        /**
         * Solutions construct to create Cloudfrotnt with an s3 bucket as the origin
         * https://docs.aws.amazon.com/solutions/latest/constructs/aws-cloudfront-s3.html
         *
         * insertHttpSecurityHeaders stays false because the construct's built-in header
         * mechanism uses a us-east-1 Lambda@Edge. Instead we supply responseHeadersPolicyProps,
         * which the construct turns into a single CloudFront ResponseHeadersPolicy (attached to
         * the default behavior) carrying both:
         *  - CORS: browser players (hls.js/dash.js/Shaka) send an Origin header on cross-origin
         *    media requests. The CachingOptimized policy forwards no headers to S3, so the bucket
         *    CORS rule can never fire through CloudFront; injecting CORS at the edge fixes
         *    cross-origin playback without splitting the cache on Origin. Wildcard origins are
         *    appropriate for public VOD (operators tighten this one policy if needed).
         *  - Security headers right-sized for a streaming CDN: HSTS, nosniff, Referrer-Policy.
         *    X-Frame-Options and CSP are intentionally omitted so the content stays embeddable in
         *    third-party players/iframes.
        */
        const cloudFront = new CloudFrontToS3(this, 'CloudFront', {
            existingBucketObj: destination,
            insertHttpSecurityHeaders: false,
            responseHeadersPolicyProps: {
                corsBehavior: {
                    accessControlAllowOrigins: ['*'],
                    accessControlAllowHeaders: ['*'],
                    accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
                    accessControlAllowCredentials: false,
                    accessControlMaxAge: cdk.Duration.seconds(3000),
                    originOverride: true
                },
                securityHeadersBehavior: {
                    strictTransportSecurity: {
                        accessControlMaxAge: cdk.Duration.days(730),
                        includeSubdomains: true,
                        override: true
                    },
                    contentTypeOptions: { override: true },
                    referrerPolicy: {
                        referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
                        override: true
                    }
                }
            },
            cloudFrontDistributionProps: {
                comment:`${cdk.Aws.STACK_NAME} Video on Demand Foundation`,
                logBucket: logsBucket,
                logFilePrefix: 'cloudfront-logs/',
                // Media distribution, not a website: no root object (the destination bucket has
                // no index.html; a root request would otherwise 403 via OAC).
                defaultRootObject: '',
                // HTTP/3 (QUIC): 0-RTT resumption and no transport head-of-line blocking help ABR
                // switching on mobile/lossy networks; automatic HTTP/2 fallback, no price change.
                httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
                // Error-response caching. Content TTLs are unchanged (CachingOptimized 24h/1y):
                // this only shapes how long errors are cached. Transient errors -> low TTL;
                // definitive client errors (400/405/414) -> keep at CloudFront's 10s default,
                // set explicitly so they don't inherit the 300s CFN property default now that a
                // CustomErrorResponses block exists. 503 (S3 SlowDown throttling) is kept at 10s
                // on purpose - a near-zero TTL would make every edge PoP retry and compound the
                // throttle. S3 origins enforce a 1s floor regardless. 416/404/501 are not
                // configured (416 is uncacheable; 404/501 are not meaningful for S3+OAC GETs).
                errorResponses: [
                    { httpStatus: 403, ttl: cdk.Duration.seconds(1) },
                    { httpStatus: 500, ttl: cdk.Duration.seconds(1) },
                    { httpStatus: 502, ttl: cdk.Duration.seconds(10) },
                    { httpStatus: 503, ttl: cdk.Duration.seconds(10) },
                    { httpStatus: 504, ttl: cdk.Duration.seconds(10) },
                    { httpStatus: 400, ttl: cdk.Duration.seconds(10) },
                    { httpStatus: 405, ttl: cdk.Duration.seconds(10) },
                    { httpStatus: 414, ttl: cdk.Duration.seconds(10) }
                ]
            }
        });
        //cdk_nag
        NagSuppressions.addResourceSuppressions(
            destination.policy!,
            [
                {
                    id: 'AwsSolutions-S10',
                    reason: 'Bucket is private and is not using HTTP'
                }
            ]
        );
        NagSuppressions.addResourceSuppressions(
            cloudFront.cloudFrontWebDistribution,
            [
                {
                    id: 'AwsSolutions-CFR1',
                    reason: 'Use case does not warrant CloudFront Geo restriction'
                }, {
                    id: 'AwsSolutions-CFR2',
                    reason: 'Use case does not warrant CloudFront integration with AWS WAF'
                }, {
                    id: 'AwsSolutions-CFR4', //same as cfn_nag rule W70
                    reason: 'CloudFront automatically sets the security policy to TLSv1 when the distribution uses the CloudFront domain name'
                }, {
                    "id": "AwsSolutions-CFR7",
                    "reason": "False alarm. The AWS-cloudfront-s3 solutions construct provides Origin-Access-Control by default.",
                },
            ]
        );
        NagSuppressions.addResourceSuppressions(
            cloudFront.cloudFrontLoggingBucket!,
            [
                {
                    id: 'AwsSolutions-S1',
                    reason: 'Used to store access logs for other buckets'
                }
            ]
        );
        /**
         * MediaConvert Service Role granting MediaConvert read/write access to the source and
         * destination buckets. Scoped to S3 GetObject/PutObject only — the encode workflow does
         * not use SPEKE DRM or Nielsen watermarking, which are the only MediaConvert features that
         * require execute-api:Invoke, so that permission is intentionally not granted.
        */
        const mediaconvertRole = new iam.Role(this, 'MediaConvertRole', {
            assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
        });
        const mediaconvertPolicy = new iam.Policy(this, 'MediaconvertPolicy', {
            statements: [
                new iam.PolicyStatement({
                    resources: [`${source.bucketArn}/*`, `${destination.bucketArn}/*`],
                    actions: ['s3:GetObject', 's3:PutObject']
                })
            ]
        });
        mediaconvertPolicy.attachToRole(mediaconvertRole);
        //cdk_nag
        NagSuppressions.addResourceSuppressions(
            mediaconvertPolicy,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: '/* required to get/put objects to S3'
                }
            ]
        );
        /**
         * MediaConvert job templates for the three source-aware quality tiers.
         * Each is a best-practice CMAF (fragmented MP4) Auto ABR / QVBR H.264 configuration;
         * the Step Functions Probe -> Choice picks a tier by source resolution (default HD)
         * and passes the matching template name to the createJob.sync task.
         */
        const tierNames = ['SD', 'HD', 'UHD'] as const;
        const jobTemplates: { [tier: string]: mediaconvert.CfnJobTemplate } = {};
        for (const tier of tierNames) {
            const templateData = JSON.parse(
                fs.readFileSync(path.join(__dirname, 'job-templates', `${tier.toLowerCase()}.json`), 'utf8')
            );
            jobTemplates[tier] = new mediaconvert.CfnJobTemplate(this, `JobTemplate${tier}`, {
                name: `${cdk.Aws.STACK_NAME}-${tier}`,
                category: templateData.Category,
                description: templateData.Description,
                settingsJson: templateData.Settings,
                accelerationSettings: { mode: templateData.AccelerationSettings.Mode },
                statusUpdateInterval: templateData.StatusUpdateInterval,
                priority: templateData.Priority
            });
        }
        /**
         * DynamoDB table holding one item per transcode job (partition key = Guid).
         * Replaces the single jobs-manifest.json object in the source bucket: concurrent
         * executions write independent items, so there is no read-modify-write race, and
         * the workflow records jobs via the native Step Functions dynamodb:putItem
         * integration (no completion Lambda). A GSI on Status supports "list by status"
         * queries without a table scan.
         */
        const jobsTable = new dynamodb.Table(this, 'JobsTable', {
            partitionKey: { name: 'Guid', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
            // The state machine writes an ExpiresAt epoch-seconds attribute (now + 90 days) so
            // completed-job records self-expire; keeps the table bounded at zero cost.
            timeToLiveAttribute: 'ExpiresAt',
            // NOTE: DESTROY is a deliberate sample-code choice so `cdk destroy` cleans up fully.
            // Adopters who need to retain job history should change this to RETAIN.
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        jobsTable.addGlobalSecondaryIndex({
            indexName: 'Status-index',
            partitionKey: { name: 'Status', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'Timestamp', type: dynamodb.AttributeType.STRING }
        });
        // The table stores only transcode-job metadata (GUIDs, MediaConvert job results, output
        // manifest names and playback URLs) — no customer content or PII — and is already
        // encrypted at rest with an AWS-managed key. A customer-managed CMK is not warranted for
        // this reference solution, so CKV_AWS_119 (checkov) is suppressed with that justification.
        const cfnJobsTable = jobsTable.node.defaultChild as dynamodb.CfnTable;
        cfnJobsTable.cfnOptions.metadata = {
            checkov: {
                skip: [{
                    id: 'CKV_AWS_119',
                    comment: 'Table holds only transcode-job metadata (GUIDs, manifests, playback URLs); no customer data or PII, already encrypted at rest with an AWS-managed key. A customer-managed CMK is not warranted for this reference solution.'
                }]
            }
        };
        /**
         * SNS topic for job status notifications, subscribed by the admin email address.
         * The state machine publishes to it directly via the native SNS integration; there
         * is no completion Lambda in v2 (playback URLs are built in ASL and job metadata is
         * written to DynamoDB via the native integration).
         */
        const snsKey = new kms.Key(this, 'CompleteSnsKey', {
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        snsKey.grant(new iam.ServicePrincipal('states.amazonaws.com'), 'kms:GenerateDataKey', 'kms:Decrypt');
        const snsTopic = new sns.Topic(this, 'CompleteSNS', {
            masterKey: snsKey
        });
        snsTopic.addSubscription(new subs.EmailSubscription(adminEmail));

        /**
         * Step Functions Standard state machine: the explicit VOD encode workflow.
         * One execution per uploaded video: Probe -> select tier -> createJob.sync ->
         * process outputs (job-complete) -> SNS publish, with a top-level failure path.
         * Placeholders in the ASL are substituted with resolved ARNs/names at synth time.
         */
        const stateMachineLogs = new logs.LogGroup(this, 'TranscodeWorkflowLogs', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        // The log group captures Step Functions execution telemetry only (state I/O for the
        // VOD workflow — GUIDs, tier choice, manifest names); it holds no customer content or
        // PII and is already encrypted at rest with an AWS-owned key. A customer-managed CMK is
        // not warranted for this reference solution, so W84 (cfn-nag) / CKV_AWS_158 (checkov) are
        // suppressed with that justification rather than adding a key to manage.
        const cfnStateMachineLogs = stateMachineLogs.node.defaultChild as logs.CfnLogGroup;
        cfnStateMachineLogs.cfnOptions.metadata = {
            cfn_nag: {
                rules_to_suppress: [{
                    id: 'W84',
                    reason: 'Step Functions execution logs contain no customer data or PII and are encrypted at rest with an AWS-owned key; a customer-managed KMS key is not warranted for this reference solution.'
                }]
            },
            checkov: {
                skip: [{
                    id: 'CKV_AWS_158',
                    comment: 'Step Functions execution logs contain no customer data or PII and are encrypted at rest with an AWS-owned key; a customer-managed KMS key is not warranted for this reference solution.'
                }]
            }
        };

        const aslTemplate = fs.readFileSync(path.join(__dirname, 'transcode-workflow.asl'), 'utf8');
        const definition = aslTemplate
            .replace(/\$\{MEDIACONVERT_ROLE_ARN\}/g, mediaconvertRole.roleArn)
            .replace(/\$\{JOB_TEMPLATE_SD\}/g, jobTemplates['SD'].name as string)
            .replace(/\$\{JOB_TEMPLATE_HD\}/g, jobTemplates['HD'].name as string)
            .replace(/\$\{JOB_TEMPLATE_UHD\}/g, jobTemplates['UHD'].name as string)
            .replace(/\$\{DESTINATION_BUCKET\}/g, destination.bucketName)
            .replace(/\$\{CLOUDFRONT_DOMAIN\}/g, cloudFront.cloudFrontWebDistribution.distributionDomainName)
            .replace(/\$\{JOBS_TABLE\}/g, jobsTable.tableName)
            .replace(/\$\{SNS_TOPIC_ARN\}/g, snsTopic.topicArn)
            .replace(/\$\{STACK_NAME\}/g, cdk.Aws.STACK_NAME);

        const transcodeWorkflowRole = new iam.Role(this, 'TranscodeWorkflowRole', {
            assumedBy: new iam.ServicePrincipal('states.amazonaws.com')
        });

        const transcodeWorkflow = new sfn.StateMachine(this, 'TranscodeWorkflow', {
            definitionBody: sfn.DefinitionBody.fromString(definition),
            stateMachineType: sfn.StateMachineType.STANDARD,
            role: transcodeWorkflowRole,
            timeout: cdk.Duration.hours(6),
            tracingEnabled: true,
            logs: {
                destination: stateMachineLogs,
                level: sfn.LogLevel.ALL,
                includeExecutionData: true
            }
        });

        /**
         * State machine permissions (least privilege, matched to the createJob.sync policy template).
         */
        const transcodeWorkflowPolicy = new iam.Policy(this, 'TranscodeWorkflowPolicy', {
            statements: [
                // Probe the source object.
                new iam.PolicyStatement({
                    actions: ["mediaconvert:Probe"],
                    resources: [`arn:${cdk.Aws.PARTITION}:mediaconvert:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:*`]
                }),
                // Create jobs from the solution-owned queue/templates/presets.
                new iam.PolicyStatement({
                    actions: ["mediaconvert:CreateJob"],
                    resources: [
                        `arn:${cdk.Aws.PARTITION}:mediaconvert:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:queues/*`,
                        `arn:${cdk.Aws.PARTITION}:mediaconvert:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:jobTemplates/*`,
                        `arn:${cdk.Aws.PARTITION}:mediaconvert:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:presets/*`
                    ]
                }),
                // Track/cancel the running job (tag-scoped to Step Functions-managed jobs).
                new iam.PolicyStatement({
                    actions: ["mediaconvert:GetJob", "mediaconvert:CancelJob"],
                    resources: [`arn:${cdk.Aws.PARTITION}:mediaconvert:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:jobs/*`],
                    conditions: {
                        StringEquals: { "aws:ResourceTag/ManagedByService": "AWSStepFunctions" }
                    }
                }),
                // Pass the MediaConvert service role to the job.
                new iam.PolicyStatement({
                    actions: ["iam:PassRole"],
                    resources: [mediaconvertRole.roleArn],
                    conditions: {
                        StringEquals: { "iam:PassedToService": "mediaconvert.amazonaws.com" }
                    }
                }),
                // EventBridge managed rule that Step Functions uses to track the .sync job.
                new iam.PolicyStatement({
                    actions: ["events:PutTargets", "events:PutRule", "events:DescribeRule"],
                    resources: [`arn:${cdk.Aws.PARTITION}:events:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:rule/StepFunctionsGetEventsForMediaConvertJobRule`]
                }),
                // Read the source object for the Probe step.
                new iam.PolicyStatement({
                    actions: ["s3:GetObject"],
                    resources: [`${source.bucketArn}/*`]
                }),
                // Record the completed job as a DynamoDB item.
                new iam.PolicyStatement({
                    actions: ["dynamodb:PutItem"],
                    resources: [jobsTable.tableArn]
                })
            ]
        });
        transcodeWorkflowRole.attachInlinePolicy(transcodeWorkflowPolicy);
        snsTopic.grantPublish(transcodeWorkflowRole);
        //cdk_nag - the state machine role wildcards are required by the MediaConvert Probe /
        // createJob.sync integration; individual job/queue/template/preset ARNs are not known
        // at synth time and job actions are additionally scoped by the ManagedByService tag.
        // The role's DefaultPolicy carries the grantInvoke (Lambda alias :*) and grantPublish wildcards.
        NagSuppressions.addResourceSuppressions(
            transcodeWorkflowPolicy,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'MediaConvert Probe/createJob.sync require wildcard queue/jobTemplate/preset/job ARNs (not known at synth time); GetJob/CancelJob are tag-scoped to ManagedByService=AWSStepFunctions and S3 read is scoped to source objects.',
                    appliesTo: [
                        'Resource::arn:<AWS::Partition>:mediaconvert:<AWS::Region>:<AWS::AccountId>:*',
                        'Resource::arn:<AWS::Partition>:mediaconvert:<AWS::Region>:<AWS::AccountId>:queues/*',
                        'Resource::arn:<AWS::Partition>:mediaconvert:<AWS::Region>:<AWS::AccountId>:jobTemplates/*',
                        'Resource::arn:<AWS::Partition>:mediaconvert:<AWS::Region>:<AWS::AccountId>:presets/*',
                        'Resource::arn:<AWS::Partition>:mediaconvert:<AWS::Region>:<AWS::AccountId>:jobs/*',
                        'Resource::<Source71E471F1.Arn>/*'
                    ]
                }
            ]
        );
        NagSuppressions.addResourceSuppressions(
            transcodeWorkflowRole,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Step Functions X-Ray tracing produces a provider-generated wildcard resource, and SNS grantPublish on the KMS-encrypted topic adds the kms:GenerateDataKey* action wildcard, on the role DefaultPolicy.',
                    appliesTo: [
                        'Resource::*',
                        'Action::kms:GenerateDataKey*'
                    ]
                }
            ],
            true
        );

        /**
         * Trigger: enable EventBridge notifications on the source bucket and start one
         * state-machine execution per uploaded video. The event pattern filters
         * detail.object.key to supported video suffixes so non-video uploads and the
         * custom resource's own seeded writes (jobs-manifest.json) never start executions.
         */
        source.enableEventBridgeNotification();

        const videoSuffixes = [
            '.mpg', '.mp4', '.m4v', '.mov', '.m2ts', '.mxf', '.mkv', '.mpeg', '.webm', '.h264', '.wmv'
        ];
        const suffixFilters = videoSuffixes
            .flatMap(suffix => [{ suffix }, { suffix: suffix.toUpperCase() }]);

        const triggerDlq = new sqs.Queue(this, 'TriggerDLQ', {
            enforceSSL: true,
            retentionPeriod: cdk.Duration.days(14)
        });
        //cdk_nag
        NagSuppressions.addResourceSuppressions(
            triggerDlq,
            [
                {
                    id: 'AwsSolutions-SQS3',
                    reason: 'This queue is itself the dead-letter queue for the EventBridge target; it does not require its own DLQ.'
                }
            ]
        );
        // The DLQ receives dead-lettered EventBridge trigger events (S3 "Object Created"
        // notifications — bucket name + object key only, no customer content or PII) and is
        // already encrypted at rest with an AWS-owned key (SSE-SQS). A customer-managed KMS key
        // is not warranted for this reference solution, so W48 (cfn-nag) / CKV_AWS_27 (checkov)
        // are suppressed with that justification.
        const cfnTriggerDlq = triggerDlq.node.defaultChild as sqs.CfnQueue;
        cfnTriggerDlq.cfnOptions.metadata = {
            ...cfnTriggerDlq.cfnOptions.metadata,
            cfn_nag: {
                rules_to_suppress: [{
                    id: 'W48',
                    reason: 'DLQ holds dead-lettered S3-notification trigger events (bucket/key only); no customer data or PII, already encrypted at rest with an AWS-owned key. A customer-managed KMS key is not warranted for this reference solution.'
                }]
            },
            checkov: {
                skip: [{
                    id: 'CKV_AWS_27',
                    comment: 'DLQ holds dead-lettered S3-notification trigger events (bucket/key only); no customer data or PII, already encrypted at rest with an AWS-owned key. A customer-managed KMS key is not warranted for this reference solution.'
                }]
            }
        };

        const sourceUploadPattern: events.EventPattern = {
            source: ['aws.s3'],
            detailType: ['Object Created'],
            detail: {
                bucket: { name: [source.bucketName] },
                object: { key: suffixFilters }
            }
        };

        new events.Rule(this, 'SourceBucketRule', {
            description: 'Starts the VOD transcode workflow when a supported video is uploaded to the source bucket.',
            eventPattern: sourceUploadPattern,
            targets: [
                new targets.SfnStateMachine(transcodeWorkflow, {
                    deadLetterQueue: triggerDlq,
                    retryAttempts: 3,
                    maxEventAge: cdk.Duration.hours(2)
                })
            ]
        });

        /**
         * Archive the source-upload events on the default bus so a window of uploads can be
         * replayed (EventBridge StartReplay) after a downstream outage — the SQS DLQ is a
         * failure sink, not a replay mechanism. Same pattern as the trigger rule.
         */
        new events.Archive(this, 'SourceUploadArchive', {
            sourceEventBus: events.EventBus.fromEventBusName(this, 'DefaultBus', 'default'),
            description: 'Replayable archive of source-bucket video-upload events for the VOD workflow.',
            eventPattern: sourceUploadPattern,
            retention: cdk.Duration.days(30)
        });

        /**
         * CloudWatch alarms on the workflow. `ExecutionsFailed` alone is not enough: a stuck
         * `.sync` job surfaces as `ExecutionsTimedOut` (not Failed), throttling surfaces as
         * `ExecutionThrottled`, and dead-lettered triggers sit silently in the DLQ. Alarm on
         * all of these so no failure mode is invisible.
         */
        const workflowAlarmDefs: { id: string; metric: cloudwatch.IMetric; description: string }[] = [
            {
                id: 'WorkflowFailuresAlarm',
                metric: transcodeWorkflow.metricFailed({ period: cdk.Duration.minutes(5) }),
                description: 'One or more VOD transcode workflow executions failed.'
            },
            {
                id: 'WorkflowTimeoutsAlarm',
                metric: transcodeWorkflow.metricTimedOut({ period: cdk.Duration.minutes(5) }),
                description: 'One or more VOD transcode workflow executions timed out (e.g. a stuck MediaConvert job).'
            },
            {
                id: 'WorkflowThrottledAlarm',
                metric: transcodeWorkflow.metricThrottled({ period: cdk.Duration.minutes(5) }),
                description: 'VOD transcode workflow executions were throttled.'
            },
            {
                id: 'WorkflowAbortedAlarm',
                metric: transcodeWorkflow.metricAborted({ period: cdk.Duration.minutes(5) }),
                description: 'One or more VOD transcode workflow executions were aborted.'
            }
        ];
        for (const def of workflowAlarmDefs) {
            new cloudwatch.Alarm(this, def.id, {
                metric: def.metric,
                threshold: 1,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
                alarmDescription: def.description
            });
        }
        /**
         * Alarm on the EventBridge target DLQ: dead-lettered triggers would otherwise sit
         * unnoticed for the queue's full 14-day retention.
         */
        new cloudwatch.Alarm(this, 'TriggerDlqNotEmptyAlarm', {
            metric: triggerDlq.metricApproximateNumberOfMessagesVisible({
                period: cdk.Duration.minutes(5),
                statistic: cloudwatch.Stats.MAXIMUM
            }),
            threshold: 1,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'A VOD workflow trigger event was dead-lettered (EventBridge could not start the state machine).'
        });

        //cdk_nag - the S3 bucket-notification handler that enables EventBridge notifications
        // is a CDK-managed singleton Lambda whose role uses the AWS managed basic-execution policy.
        const bucketNotificationsHandler = this.node.tryFindChild(
            'BucketNotificationsHandler050a0587b7544547bf325f094a3db834'
        );
        if (bucketNotificationsHandler) {
            NagSuppressions.addResourceSuppressions(
                bucketNotificationsHandler,
                [
                    {
                        id: 'AwsSolutions-IAM4',
                        reason: 'CDK-managed S3 bucket-notifications handler role uses the AWS managed AWSLambdaBasicExecutionRole policy.',
                        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole']
                    }
                ],
                true
            );
        }

        /**
         * Stack Outputs
        */
        new cdk.CfnOutput(this, 'SourceBucket', { // NOSONAR
            value: source.bucketName,
            description: 'Source S3 Bucket used to host source video and MediaConvert job settings files',
            exportName: `${ cdk.Aws.STACK_NAME}-SourceBucket`
        });
        new cdk.CfnOutput(this, 'DestinationBucket', { // NOSONAR
            value: destination.bucketName,
            description: 'Source S3 Bucket used to host all MediaConvert ouputs',
            exportName: `${ cdk.Aws.STACK_NAME}-DestinationBucket`
        });
        new cdk.CfnOutput(this, 'CloudFrontDomain', { // NOSONAR
            value: cloudFront.cloudFrontWebDistribution.distributionDomainName,
            description: 'CloudFront Domain Name',
            exportName: `${ cdk.Aws.STACK_NAME}-CloudFrontDomain`
        });
        new cdk.CfnOutput(this, 'SnsTopic', { // NOSONAR
            value: snsTopic.topicName,
            description: 'SNS Topic used to capture the VOD workflow outputs including errors',
            exportName: `${ cdk.Aws.STACK_NAME}-SnsTopic`
        });
    }
}
