{
  "Comment": "VOD Foundation transcode workflow: probe source, select quality tier, encode with MediaConvert (.sync), process outputs, and notify.",
  "StartAt": "Prepare Input",
  "States": {
    "Prepare Input": {
      "Type": "Pass",
      "Comment": "Derive the source s3:// URI, bucket, and key from the S3 EventBridge event, and mint a random job GUID (States.UUID(), not derived from the event) used as the output prefix and DynamoDB key.",
      "Parameters": {
        "fileUri.$": "States.Format('s3://{}/{}', $.detail.bucket.name, $.detail.object.key)",
        "guid.$": "States.UUID()",
        "srcBucket.$": "$.detail.bucket.name",
        "srcKey.$": "$.detail.object.key"
      },
      "ResultPath": "$",
      "Next": "Probe"
    },
    "Probe": {
      "Type": "Task",
      "Comment": "Read source metadata (resolution, codec, duration) via the MediaConvert Probe API.",
      "Resource": "arn:aws:states:::aws-sdk:mediaconvert:probe",
      "TimeoutSeconds": 60,
      "Parameters": {
        "InputFiles": [
          {
            "FileUrl.$": "$.fileUri"
          }
        ]
      },
      "ResultPath": "$.probe",
      "Retry": [
        {
          "ErrorEquals": [
            "MediaConvert.TooManyRequestsException",
            "MediaConvert.InternalServerErrorException",
            "MediaConvert.ConflictException"
          ],
          "IntervalSeconds": 3,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.error",
          "Next": "Notify Failure"
        }
      ],
      "Next": "Extract Video Metadata"
    },
    "Extract Video Metadata": {
      "Type": "Pass",
      "QueryLanguage": "JSONata",
      "Comment": "MediaConvert Probe does not guarantee the video track is first in Tracks[] (e.g. audio-first MP4s list audio at index 0), so a fixed Tracks[0] path misses the video. Select the track whose TrackType is 'video' and normalize its height into $.videoHeight; downstream Choice states read $.videoHeight so they work regardless of track order. When no video track is present the field is absent, routing to Unsupported Source.",
      "Output": "{% $merge([$states.input, {'videoHeight': ([$states.input.probe.ProbeResults[0].Container.Tracks[TrackType = 'video'].VideoProperties.Height])[0]}]) %}",
      "Next": "Check Video Track"
    },
    "Check Video Track": {
      "Type": "Choice",
      "Comment": "Only proceed for probe results that contain a decodable video track (height normalized by Extract Video Metadata).",
      "Choices": [
        {
          "Variable": "$.videoHeight",
          "IsPresent": true,
          "Next": "Choose Quality Tier"
        }
      ],
      "Default": "Unsupported Source"
    },
    "Unsupported Source": {
      "Type": "Pass",
      "Parameters": {
        "guid.$": "$.guid",
        "srcKey.$": "$.srcKey",
        "error": {
          "Error": "UnsupportedSource",
          "Cause": "The uploaded object does not contain a probeable video track."
        }
      },
      "ResultPath": "$",
      "Next": "Notify Failure"
    },
    "Choose Quality Tier": {
      "Type": "Choice",
      "Comment": "Map probed source height to a quality tier. SD is below 720 (e.g. 480/576); 720p and 1080p are HD; 1440p and above are UHD (the default). Branches are ordered SD, HD, UHD so the workflow graph reads left-to-right; UHD is the Default because the Default branch renders last.",
      "Choices": [
        {
          "Variable": "$.videoHeight",
          "NumericLessThan": 720,
          "Next": "Encode SD"
        },
        {
          "Variable": "$.videoHeight",
          "NumericLessThan": 1440,
          "Next": "Encode HD"
        }
      ],
      "Default": "Encode UHD"
    },
    "Encode SD": {
      "Type": "Task",
      "Resource": "arn:aws:states:::mediaconvert:createJob.sync",
      "TimeoutSeconds": 1800,
      "Parameters": {
        "Role": "${MEDIACONVERT_ROLE_ARN}",
        "JobTemplate": "${JOB_TEMPLATE_SD}",
        "UserMetadata": {
          "guid.$": "$.guid",
          "StackName": "${STACK_NAME}"
        },
        "Settings": {
          "Inputs": [
            {
              "AudioSelectors": {
                "Audio Selector 1": {
                  "DefaultSelection": "DEFAULT"
                }
              },
              "VideoSelector": {
                "Rotate": "AUTO"
              },
              "FileInput.$": "$.fileUri"
            }
          ],
          "OutputGroups": [
            {
              "OutputGroupSettings": {
                "CmafGroupSettings": {
                  "Destination.$": "States.Format('s3://${DESTINATION_BUCKET}/{}/index', $.guid)"
                }
              }
            }
          ]
        }
      },
      "ResultPath": "$.jobOutput",
      "Retry": [
        {
          "ErrorEquals": [
            "MediaConvert.TooManyRequestsException",
            "MediaConvert.InternalServerErrorException",
            "MediaConvert.ConflictException"
          ],
          "IntervalSeconds": 5,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.error",
          "Next": "Notify Failure"
        }
      ],
      "Next": "Build Playback URLs"
    },
    "Encode HD": {
      "Type": "Task",
      "Resource": "arn:aws:states:::mediaconvert:createJob.sync",
      "TimeoutSeconds": 3600,
      "Parameters": {
        "Role": "${MEDIACONVERT_ROLE_ARN}",
        "JobTemplate": "${JOB_TEMPLATE_HD}",
        "UserMetadata": {
          "guid.$": "$.guid",
          "StackName": "${STACK_NAME}"
        },
        "Settings": {
          "Inputs": [
            {
              "AudioSelectors": {
                "Audio Selector 1": {
                  "DefaultSelection": "DEFAULT"
                }
              },
              "VideoSelector": {
                "Rotate": "AUTO"
              },
              "FileInput.$": "$.fileUri"
            }
          ],
          "OutputGroups": [
            {
              "OutputGroupSettings": {
                "CmafGroupSettings": {
                  "Destination.$": "States.Format('s3://${DESTINATION_BUCKET}/{}/index', $.guid)"
                }
              }
            }
          ]
        }
      },
      "ResultPath": "$.jobOutput",
      "Retry": [
        {
          "ErrorEquals": [
            "MediaConvert.TooManyRequestsException",
            "MediaConvert.InternalServerErrorException",
            "MediaConvert.ConflictException"
          ],
          "IntervalSeconds": 5,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.error",
          "Next": "Notify Failure"
        }
      ],
      "Next": "Build Playback URLs"
    },
    "Encode UHD": {
      "Type": "Task",
      "Resource": "arn:aws:states:::mediaconvert:createJob.sync",
      "TimeoutSeconds": 7200,
      "Parameters": {
        "Role": "${MEDIACONVERT_ROLE_ARN}",
        "JobTemplate": "${JOB_TEMPLATE_UHD}",
        "UserMetadata": {
          "guid.$": "$.guid",
          "StackName": "${STACK_NAME}"
        },
        "Settings": {
          "Inputs": [
            {
              "AudioSelectors": {
                "Audio Selector 1": {
                  "DefaultSelection": "DEFAULT"
                }
              },
              "VideoSelector": {
                "Rotate": "AUTO"
              },
              "FileInput.$": "$.fileUri"
            }
          ],
          "OutputGroups": [
            {
              "OutputGroupSettings": {
                "CmafGroupSettings": {
                  "Destination.$": "States.Format('s3://${DESTINATION_BUCKET}/{}/index', $.guid)"
                }
              }
            }
          ]
        }
      },
      "ResultPath": "$.jobOutput",
      "Retry": [
        {
          "ErrorEquals": [
            "MediaConvert.TooManyRequestsException",
            "MediaConvert.InternalServerErrorException",
            "MediaConvert.ConflictException"
          ],
          "IntervalSeconds": 5,
          "MaxAttempts": 5,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.error",
          "Next": "Notify Failure"
        }
      ],
      "Next": "Build Playback URLs"
    },
    "Build Playback URLs": {
      "Type": "Pass",
      "Comment": "Derive the CloudFront HLS/DASH URLs and the output S3 location from the deterministic destination (s3://<dest>/<guid>/index). No GetJob or Lambda needed.",
      "Parameters": {
        "guid.$": "$.guid",
        "srcBucket.$": "$.srcBucket",
        "srcKey.$": "$.srcKey",
        "probe.$": "$.probe",
        "jobOutput.$": "$.jobOutput",
        "outputs": {
          "hls.$": "States.Format('https://${CLOUDFRONT_DOMAIN}/{}/index.m3u8', $.guid)",
          "dash.$": "States.Format('https://${CLOUDFRONT_DOMAIN}/{}/index.mpd', $.guid)",
          "outputManifestHls.$": "States.Format('{}/index.m3u8', $.guid)",
          "outputManifestDash.$": "States.Format('{}/index.mpd', $.guid)",
          "destinationS3.$": "States.Format('s3://${DESTINATION_BUCKET}/{}/', $.guid)"
        }
      },
      "ResultPath": "$",
      "Next": "Record Job"
    },
    "Record Job": {
      "Type": "Task",
      "QueryLanguage": "JSONata",
      "Comment": "Write one item per job to DynamoDB (native integration). One item per execution, so there is no manifest read-modify-write race. This state uses JSONata so ExpiresAt (DynamoDB TTL) can be computed as now + 90 days of epoch seconds; Output passes the state input through unchanged for the downstream JSONPath states.",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "TimeoutSeconds": 15,
      "Arguments": {
        "TableName": "${JOBS_TABLE}",
        "Item": {
          "Guid": { "S": "{% $states.input.guid %}" },
          "Status": { "S": "Complete" },
          "Timestamp": { "S": "{% $states.context.State.EnteredTime %}" },
          "ExpiresAt": { "N": "{% $string($floor($millis() / 1000) + 7776000) %}" },
          "SrcBucket": { "S": "{% $states.input.srcBucket %}" },
          "SrcKey": { "S": "{% $states.input.srcKey %}" },
          "JobId": { "S": "{% $states.input.jobOutput.Job.Id %}" },
          "JobTemplate": { "S": "{% $states.input.jobOutput.Job.JobTemplate %}" },
          "HlsUrl": { "S": "{% $states.input.outputs.hls %}" },
          "DashUrl": { "S": "{% $states.input.outputs.dash %}" },
          "OutputManifestHls": { "S": "{% $states.input.outputs.outputManifestHls %}" },
          "OutputManifestDash": { "S": "{% $states.input.outputs.outputManifestDash %}" },
          "DestinationS3": { "S": "{% $states.input.outputs.destinationS3 %}" },
          "Probe": { "S": "{% $string($states.input.probe.ProbeResults) %}" },
          "JobResult": { "S": "{% $string($states.input.jobOutput.Job) %}" }
        }
      },
      "Output": "{% $states.input %}",
      "Retry": [
        {
          "ErrorEquals": [
            "DynamoDB.ThrottlingException",
            "DynamoDB.InternalServerErrorException",
            "DynamoDB.ProvisionedThroughputExceededException"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Output": "{% $merge([$states.input, {'error': $states.errorOutput}]) %}",
          "Next": "Notify Failure"
        }
      ],
      "Next": "Notify Success"
    },
    "Notify Success": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "TimeoutSeconds": 15,
      "Parameters": {
        "TopicArn": "${SNS_TOPIC_ARN}",
        "Subject.$": "States.Format('{}: VOD job COMPLETE id:{}', '${STACK_NAME}', $.guid)",
        "Message.$": "States.Format('Video \"{}\" is ready.\n\nHLS:  {}\nDASH: {}\n\nOutput location: {}\nJob ID: {}', $.srcKey, $.outputs.hls, $.outputs.dash, $.outputs.destinationS3, $.guid)"
      },
      "End": true
    },
    "Notify Failure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "TimeoutSeconds": 15,
      "Parameters": {
        "TopicArn": "${SNS_TOPIC_ARN}",
        "Subject.$": "States.Format('{}: VOD job ERROR id:{}', '${STACK_NAME}', $.guid)",
        "Message.$": "States.Format('Video \"{}\" failed to process.\n\nJob ID: {}\nError: {}\nCause: {}', $.srcKey, $.guid, $.error.Error, $.error.Cause)"
      },
      "Next": "Workflow Failed"
    },
    "Workflow Failed": {
      "Type": "Fail",
      "Error": "VodWorkflowFailed",
      "Cause": "The VOD transcode workflow failed. See the SNS error notification and the execution history for details."
    }
  }
}
