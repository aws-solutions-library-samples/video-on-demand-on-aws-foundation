/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { HttpMethods } from 'aws-cdk-lib/aws-s3';
import * as appreg from '@aws-cdk/aws-servicecatalogappregistry-alpha';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
/**
 * AWS Solution Constructs: https://docs.aws.amazon.com/solutions/latest/constructs/
 */
import { CloudFrontToS3 } from '@aws-solutions-constructs/aws-cloudfront-s3';
import { EventbridgeToLambda } from '@aws-solutions-constructs/aws-eventbridge-lambda';
import { LambdaToSns } from '@aws-solutions-constructs/aws-lambda-sns';


export class VodFoundation extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        /**
         * CloudFormation Template Descrption
         */
        const solutionId = 'SO9673'
        const solutionName = 'Video on Demand on AWS Foundation'
        const solutionVersion = scope.node.tryGetContext('solution_version') ?? '%%VERSION%%';
        this.templateOptions.description = `(${solutionId}) ${solutionName} Solution Implementation. Version ${solutionVersion}`;
        /**
         * Mapping for sending anonymized metrics to AWS Solution Builders API
         */
        const sendMetrics = new cdk.CfnMapping(this, 'Send', {
            mapping: {
                AnonymizedUsage: {
                    Data: 'Yes'
                }
            }
        });
        /**
         * Cfn Parameters
         */
        const adminEmail = new cdk.CfnParameter(this, "emailAddress", {
            type: "String",
            description: "The admin email address to receive SNS notifications for job status.",
            allowedPattern: "^[_A-Za-z0-9-\\+]+(\\.[_A-Za-z0-9-]+)*@[A-Za-z0-9-]+(\\.[A-Za-z0-9]+)*(\\.[A-Za-z]{2,})$"
        });
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
         * insertHttpSecurityHeaders is set to false as this requires the deployment to be in us-east-1
        */
        const cloudFront = new CloudFrontToS3(this, 'CloudFront', {
            existingBucketObj: destination,
            insertHttpSecurityHeaders: false,
            cloudFrontDistributionProps: {
                comment:`${cdk.Aws.STACK_NAME} Video on Demand Foundation`,
                defaultCacheBehavior: {
                    allowedMethods: [ 'GET', 'HEAD','OPTIONS' ],
                    Compress: false,
                    forwardedValues: {
                      queryString: false,
                      headers: [ 'Origin', 'Access-Control-Request-Method','Access-Control-Request-Headers' ],
                      cookies: { forward: 'none' }
                    },
                    viewerProtocolPolicy: 'allow-all'
                },
                logBucket: logsBucket,
                logFilePrefix: 'cloudfront-logs/'
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
         * MediaConvert Service Role to grant Mediaconvert Access to the source and Destination Bucket,
         * API invoke * is also required for the services.
        */
        const mediaconvertRole = new iam.Role(this, 'MediaConvertRole', {
            assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
        });
        const mediaconvertPolicy = new iam.Policy(this, 'MediaconvertPolicy', {
            statements: [
                new iam.PolicyStatement({
                    resources: [`${source.bucketArn}/*`, `${destination.bucketArn}/*`],
                    actions: ['s3:GetObject', 's3:PutObject']
                }),
                new iam.PolicyStatement({
                    resources: [`arn:${cdk.Aws.PARTITION}:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:*`],
                    actions: ['execute-api:Invoke']
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
         * Custom Resource, Role and Policy.
         */
        const customResourceRole = new iam.Role(this, 'CustomResourceRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
        });

        const customResourcePolicy = new iam.Policy(this, 'CustomResourcePolicy', {
            statements: [
                new iam.PolicyStatement({
                    actions: ["s3:PutObject","s3:PutBucketNotification"],
                    resources: [source.bucketArn, `${source.bucketArn}/*`]
                }),
                new iam.PolicyStatement({
                    actions: ["mediaconvert:DescribeEndpoints"],
                    resources: [`arn:aws:mediaconvert:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:*`],
                }),
                new iam.PolicyStatement({
                    actions: [
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    resources: ['*'],
                })
            ]
        });
        customResourcePolicy.attachToRole(customResourceRole);

        //cdk_nag
        addResourceSuppressions(
            customResourcePolicy,
            [
                {
                    id: [ 'AwsSolutions-IAM5', 'W12' ],
                    reason: 'Resource ARNs are not generated at the time of policy creation'
                }
            ]
        );

        const customResourceLambda = new lambda.Function(this, 'CustomResource', {
            runtime: lambda.Runtime.NODEJS_22_X,
            handler: 'index.handler',
            description: 'CFN Custom resource to copy assets to S3 and get the MediaConvert endpoint',
            environment: {
                SOLUTION_IDENTIFIER: `AwsSolution/${solutionId}/${solutionVersion}`
            },
            code: lambda.Code.fromAsset('../custom-resource'),
            timeout: cdk.Duration.seconds(30),
            role: customResourceRole
        });
        customResourceLambda.node.addDependency(customResourcePolicy);
        customResourceLambda.node.addDependency(customResourceRole);
        /** get the cfn resource for the role and attach cfn_nag rule */
        const cfnCustomResource = customResourceLambda.node.findChild('Resource') as lambda.CfnFunction;
        cfnCustomResource.cfnOptions.metadata = {
            cfn_nag: {
                rules_to_suppress: [{
                    id: 'W58',
                    reason: 'Invalid warning: function has access to cloudwatch'
                },
                {
                    id: 'W89',
                    reason: 'Invalid warning: lambda not needed in VPC'
                },
                {
                    id: 'W92',
                    reason: 'Invalid warning: lambda does not need ReservedConcurrentExecutions'
                }]
            }
        };
        /**
         * Call the custom resource, this will return the MediaConvert endpoint and a UUID
        */
        const customResourceEndpoint = new cdk.CustomResource(this, 'Endpoint', {
            serviceToken: customResourceLambda.functionArn
        });

        /**
         * Job submit Lambda function, triggered by S3 Put events in the source S3 bucket
        */
        const jobSubmitRole = new iam.Role(this, 'JobSubmitRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
        });
        const jobSubmitPolicy = new iam.Policy(this, 'JobSubmitPolicy', {
            statements: [
                new iam.PolicyStatement({
                    actions: ["iam:PassRole"],
                    resources: [mediaconvertRole.roleArn]
                }),
                new iam.PolicyStatement({
                    actions: ["mediaconvert:CreateJob"],
                    resources: [`arn:${cdk.Aws.PARTITION}:mediaconvert:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:*`]
                }),
                new iam.PolicyStatement({
                    actions: ["s3:GetObject", "s3:ListBucket"],
                    resources: [source.bucketArn, `${source.bucketArn}/*`]
                }),
                new iam.PolicyStatement({
                    actions: [
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    resources: ['*'],
                })
            ]
        });
        jobSubmitPolicy.attachToRole(jobSubmitRole);
        //cdk_nag
        addResourceSuppressions(
            jobSubmitPolicy,
            [
                {
                    id: [ 'AwsSolutions-IAM5', 'W12' ],
                    reason: 'Resource ARNs are not generated at the time of policy creation'
                }
            ]
        );

        const jobSubmit = new lambda.Function(this, 'jobSubmit', {
            code: lambda.Code.fromAsset(`../job-submit`),
            runtime: lambda.Runtime.NODEJS_22_X,
            handler: 'index.handler',
            timeout: cdk.Duration.seconds(30),
            retryAttempts:0,
            description: 'Submits an Encoding job to MediaConvert',
            environment: {
                MEDIACONVERT_ENDPOINT: customResourceEndpoint.getAttString('Endpoint'),
                MEDIACONVERT_ROLE: mediaconvertRole.roleArn,
                JOB_SETTINGS: 'job-settings.json',
                DESTINATION_BUCKET: destination.bucketName,
                SOLUTION_ID: solutionId,
                STACKNAME: cdk.Aws.STACK_NAME,
                SOLUTION_IDENTIFIER: `AwsSolution/${solutionId}/${solutionVersion}`
                /** SNS_TOPIC_ARN: added by the solution construct below */
            },
            role: jobSubmitRole
        });
        jobSubmit.node.addDependency(jobSubmitPolicy);
        jobSubmit.node.addDependency(jobSubmitRole);

        /** Give S3 permission to trigger the job submit lambda function  */
        jobSubmit.addPermission('S3Trigger', {
            principal: new iam.ServicePrincipal('s3.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceAccount: cdk.Aws.ACCOUNT_ID
        });
        /** get the cfn resource for the role and attach cfn_nag rule */
        const cfnJobSubmit = jobSubmit.node.findChild('Resource') as lambda.CfnFunction;
        cfnJobSubmit.cfnOptions.metadata = {
            cfn_nag: {
                rules_to_suppress: [{
                    id: 'W58',
                    reason: 'Invalid warning: function has access to cloudwatch'
                },
                {
                    id: 'W89',
                    reason: 'Invalid warning: lambda not needed in VPC'
                },
                {
                    id: 'W92',
                    reason: 'Invalid warning: lambda does not need ReservedConcurrentExecutions'
                }]
            }
        };
        /**
         * Process outputs lambda function, invoked by EventBridge for MediaConvert.
         * Parses the event outputs, creates the CloudFront URLs for the outputs, updates
         * a manifest file in the destination bucket and send an SNS notfication.
         * Enviroment variables for the destination bucket and SNS topic are added by the
         *  solutions constructs
         */
        const jobCompleteRole = new iam.Role(this, 'JobCompleteRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
        });
        const jobCompletePolicy = new iam.Policy(this, 'JobCompletePolicy', {
            statements: [
                new iam.PolicyStatement({
                    actions: ["mediaconvert:GetJob"],
                    resources: [`arn:${cdk.Aws.PARTITION}:mediaconvert:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:*`]
                }),
                new iam.PolicyStatement({
                    actions: ["s3:GetObject", "s3:PutObject"],
                    resources: [`${source.bucketArn}/*`]
                }),
                new iam.PolicyStatement({
                    actions: [
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    resources: ['*'],
                })
            ]
        });
        jobCompletePolicy.attachToRole(jobCompleteRole);
        //cdk_nag
        addResourceSuppressions(
            jobCompletePolicy,
            [
                {
                    id: [ 'AwsSolutions-IAM5', 'W12' ],
                    reason: 'Resource ARNs are not generated at the time of policy creation'
                }
            ]
        );

        const jobComplete = new lambda.Function(this, 'JobComplete', {
            code: lambda.Code.fromAsset(`../job-complete`),
            runtime: lambda.Runtime.NODEJS_22_X,
            handler: 'index.handler',
            timeout: cdk.Duration.seconds(30),
            retryAttempts:0,
            description: 'Triggered by EventBridge,processes completed MediaConvert jobs.',
            environment: {
                MEDIACONVERT_ENDPOINT: customResourceEndpoint.getAttString('Endpoint'),
                CLOUDFRONT_DOMAIN: cloudFront.cloudFrontWebDistribution.distributionDomainName,
                /** SNS_TOPIC_ARN: added by the solution construct below */
                SOURCE_BUCKET: source.bucketName,
                JOB_MANIFEST: 'jobs-manifest.json',
                STACKNAME: cdk.Aws.STACK_NAME,
                METRICS:  sendMetrics.findInMap('AnonymizedUsage', 'Data'),
                SOLUTION_ID: solutionId,
                VERSION:solutionVersion,
                UUID:customResourceEndpoint.getAttString('UUID'),
                SOLUTION_IDENTIFIER: `AwsSolution/${solutionId}/${solutionVersion}`
            },
            role: jobCompleteRole
        });
        jobComplete.node.addDependency(jobCompletePolicy);
        jobComplete.node.addDependency(jobCompleteRole);

        const cfnJobComplete = jobComplete.node.findChild('Resource') as lambda.CfnFunction;
        cfnJobComplete.cfnOptions.metadata = {
            cfn_nag: {
                rules_to_suppress: [{
                    id: 'W58',
                    reason: 'Invalid warning: function has access to cloudwatch'
                },
                {
                    id: 'W89',
                    reason: 'Invalid warning: lambda not needed in VPC'
                },
                {
                    id: 'W92',
                    reason: 'Invalid warning: lambda does not need ReservedConcurrentExecutions'
                }]
            }
        };
        /**
         * Custom resource to configure the source S3 bucket; upload default job-settings file and 
         * enabble event notifications to trigger the job-submit lambda function
         */
        new cdk.CustomResource(this, 'S3Config', { // NOSONAR
            serviceToken: customResourceLambda.functionArn,
            properties: {
                SourceBucket: source.bucketName,
                LambdaArn: jobSubmit.functionArn
            }
        });
        /**
         * Solution constructs, creates a EventBridge rule to trigger the process
         * outputs lambda functions.
         */
        new EventbridgeToLambda(this, 'EventTrigger', { // NOSONAR
            existingLambdaObj: jobComplete,
            eventRuleProps: {
                enabled: true,
                eventPattern: {
                    "source": ["aws.mediaconvert"],
                    "detail": {
                        "userMetadata": {
                            "StackName": [
                                cdk.Aws.STACK_NAME
                            ]
                        },
                        "status": [
                            "COMPLETE",
                            "ERROR",
                            "CANCELED",
                            "INPUT_INFORMATION"
                        ]
                    }
                }
            }
        });
        /**
         * Solutions construct, creates an SNS topic and a Lambda function  with permission
         * to publish messages to the topic. Also adds the SNS topic to the lambda Enviroment
         * varribles
        */
        const snsTopic = new LambdaToSns(this, 'Notification', {
            existingLambdaObj: jobSubmit
        });
        new LambdaToSns(this, 'CompleteSNS', { // NOSONAR
            existingLambdaObj: jobComplete,
            existingTopicObj: snsTopic.snsTopic
        });
        /**
         * Subscribe the admin email address to the SNS topic created but the construct.
         */
        snsTopic.snsTopic.addSubscription(new subs.EmailSubscription(adminEmail.valueAsString))

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
            value: snsTopic.snsTopic.topicName,
            description: 'SNS Topic used to capture the VOD workflow outputs including errors',
            exportName: `${ cdk.Aws.STACK_NAME}-SnsTopic`
        });
    }
}

/**
 * Interface for creating a rule suppression
 */
interface NagSuppressionRules {
    /**
     * The id or array of IDs of the CDK or CFN rule or rules to ignore
     */
    readonly id: string | string[];
    /**
     * The reason to ignore the rule (minimum 10 characters)
     */
    readonly reason: string;
}

/**
 * Interface for creating a rule suppression
 */
interface NagSuppressionRule {
    /**
     * The id of the CDK or CFN rule to ignore
     */
    readonly id: string
    /**
     * The reason to ignore the rule (minimum 10 characters)
     */
    readonly reason: string;
}

/**
 * Add CFN and/or CDK NAG rule suppressions to resources.
 */
function addResourceSuppressions(resource: cdk.IResource | cdk.CfnResource, rules: NagSuppressionRules[]): void {
    // Separate CDK Nag rules from CFN Nag rules.
    const cdkRules: NagSuppressionRule[] = [];
    const cfnRules: NagSuppressionRule[] = [];
    for (const rule of rules) {
        for (const id of (Array.isArray(rule.id) ? rule.id : [rule.id])) {
            const nagRules = id.startsWith("AwsSolutions-") ? cdkRules : cfnRules;
            nagRules.push({ id, reason: rule.reason });
        }
    }

    // Add any CDK Nag rules that were found.
    if (cdkRules.length > 0) {
        NagSuppressions.addResourceSuppressions(resource, cdkRules);
    }

    // Add any CFN Nag rules that were found.
    if (cfnRules.length > 0) {
        // Get at the L1 construct for a CFN Resource.
        const cfn: cdk.CfnResource = resource instanceof cdk.CfnResource
            ? resource
            : resource.node.defaultChild as cdk.CfnResource;

        // Get the metadata object for CFN Nag rule suppressions.
        const metadata = cfn.getMetadata('cfn_nag') ?? {};
        // Concatenate new rules with existing rules if there are any.
        metadata.rules_to_suppress = [ ...(metadata.rules_to_suppress ?? []), ...cfnRules ];
        // Add the metadata object to the resource.
        cfn.addMetadata('cfn_nag', metadata);
    }
}
