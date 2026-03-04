# Guidance for Video on Demand on AWS Foundation

_Deploy a customizable architecture to build a video-on-demand workflow._

---

## About this guidance

Video on Demand on AWS Foundation is a reference implementation that automatically provisions the
Amazon Web Services (AWS) services necessary to build a scalable, distributed video-on-demand
workflow.

## Guidance overview

We designed this guidance to help you start encoding video files with AWS Elemental MediaConvert.
You can customize and use this guidance as the starting point to create a more complex workflow.

Out of the box, this guidance helps you to accomplish the following:

- Automatically transcode videos uploaded to Amazon Simple Storage Service (Amazon S3) into formats
  suitable for playback on a wide range of devices.
- Customize MediaConvert job settings by uploading your own file and using different job settings
  for different inputs.
- Store transcoded files in a destination bucket and use Amazon CloudFront to deliver to end
  viewers.
- Manage costs, view logs, implement patching, and run automation runbooks for this guidance from a
  central location.

In addition to the transcoded video, the outputs include input file metadata, job settings, and
output details. These outputs are stored in a separate JSON file that can be used for further
processing.

### Benefits

**Reference implementation** - Leverage this guidance as a reference implementation to automatically
provision the AWS services necessary to build a scalable, distributed video-on-demand workflow.

**Customization** - Customize this guidance and then use it as the starting point to create a more
complex workflow.

### Use cases

**Streaming media** - As consumer demand for video streaming increases, media and entertainment
companies are looking for secure and reliable web-based video streaming alternatives to traditional
television. This guidance automatically provisions the services necessary to build a scalable,
distributed architecture that ingests, stores, processes, and delivers video content. Using this
guidance, you can avoid inefficient trial-and-error approaches, and save on time and costs for your
streaming media projects.

**Educational content delivery** - Professional development and educational initiatives create
incentives and can be important revenue generators for nonprofit organizations. This guidance can
help you create modern, scalable content delivery and learning management systems to support your
membership and programming offerings. The guidance streamlines the processes for delivering online
training and learning content.


## Architecture overview


### Architecture reference diagram

Deploying this guidance with the default parameters deploys the following components in your AWS
account.
![Architecture](architecture.png)

## Prerequisites

* [AWS Command Line Interface](https://aws.amazon.com/cli/)
* Node.js 22.x or later
* aws-cdk version 2.200.0

## How to deploy the guidance

We developed this guidance using the AWS Cloud Development Kit (CDK) and leveraging three of the
[AWS Solutions Constructs](https://docs.aws.amazon.com/solutions/latest/constructs/welcome.html). To
make changes to the guidance:

1. Download or clone this repo.
2. Update the source code.
3. Either deploy the guidance using the CDK or run the `deployment/build-s3-dist.sh` script. The
   build script:
    1. Generates the CloudFormation template from the CDK source code using cdk synth.
    2. Runs `deployment/cdk-solution-helper` to update the template so that it pulls the Lambda
       source code from Amazon S3.
    3. Packages the Lambda code ready to be deployed to an Amazon S3 bucket in your account.

For details on deploying the guidance using the CDK see the [CDK Getting Started
guide](https://docs.aws.amazon.com/cdk/latest/guide/hello_world.html).

### 1. Run unit tests for customization

Run unit tests to ensure that your added customization passes the tests:

```
cd deployment
chmod +x ./run-unit-tests.sh
./run-unit-tests.sh
```

### 2. Create an S3 bucket

We configured the CloudFormation template to pull the Lambda deployment packages from an S3 bucket
in the Region the template is being launched in. Create a bucket in the desired Region and append
the Region name to the bucket name (for example, `my-bucket-us-east-1`).

```
aws s3 mb s3://my-bucket-us-east-1
```

### 3. Create the deployment packages
Build the distributable:
```
chmod +x ./build-s3-dist.sh
./build-s3-dist.sh my-bucket video-on-demand-on-aws-foundation v1.2.0
```

> **Note:** The `_build-s3-dist_ script` expects the bucket name as one of its parameters, and this
> value should not include the Region suffix.

Deploy the distributable to the S3 bucket in your account:

```
aws s3 cp ./regional-s3-assets/ s3://my-bucket-us-east-1/video-on-demand-on-aws-foundation/v1.2.0/ \
    --recursive --acl bucket-owner-full-control
```

### 4. Launch the CloudFormation template

Deploy the CloudFormation template from
`deployment/global-assets/video-on-demand-on-aws-foundation.template` into the same Region as your
newly created S3 bucket.


## Troubleshooting

The email address you provided when deploying this guidance receives notifications both when
MediaConvert jobs complete successfully and when they fail. The email address also receives
notifications about errors that might have occurred while trying to submit a job or process the
output from a job.

If you’re notified about a MediaConvert job failure, complete the following steps.

1. From the main account where the guidance is deployed, sign in to the AWS Elemental MediaConvert
   console.
2. In the navigation pane, select **Jobs**.
3. Select the **job ID** of the job that failed.
4. On the **Job Summary** page, review the **Overview** section for an error message with more
   information on why the job failed. On this page, you can also find MediaConvert error codes for
   details on how to address the issue.

If the error is not a MediaConvert job failure, possibly one of the two Lambda functions,
`job_submit` or `job_complete`, encountered an error. The email you received has an `ErrorDetails`
link that takes you directly to the CloudWatch logs generated by the failed function. The logs have
additional details on why it failed.

> **Note:** When overriding the sample job-settings.json, we recommend exporting job settings from a
> MediaConvert job that’s successfully completed. Incorrect encoding settings will result in the
> `job_submit` Lambda function to fail.

## How to uninstall the guidance

You can uninstall this guidance from the AWS Management Console or by using the AWS CLI. You must
manually delete the S3 buckets and CloudWatch logs created by this guidance. AWS guidances do not
automatically delete these resources in case you have stored data to retain.

For more detailed instructions, see the [guidance implementation guide][IG].

## Collection of operational metrics

This guidance collects anonymized operational metrics to help AWS improve the quality and features of
the guidance. For more information, including how to disable this capability, please see the
[implementation guide][IG].

## License information

Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in
compliance with the License. You may obtain a copy of the License at
[http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0).

Unless required by applicable law or agreed to in writing, software distributed under the License is
distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied. See the License for the specific language governing permissions and limitations under the
License.

[IG]: https://docs.aws.amazon.com/guidances/latest/video-on-demand-on-aws-foundation/welcome.html
