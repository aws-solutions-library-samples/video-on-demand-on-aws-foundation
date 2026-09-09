/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as VodStack from '../lib/vod-foundation-stack';
import { version as pkgVersion } from '../package.json';

// The app entry point (bin/vod-foundation.ts) derives solution_version from package.json;
// mirror that here so the synthesized template description matches a real deploy.
const solutionVersion = pkgVersion.startsWith('v') ? pkgVersion : `v${pkgVersion}`;

// The CloudFrontToS3 construct logs an AWS_SOLUTIONS_CONSTRUCTS_WARNING on every synth
// because we intentionally override defaultRootObject to '' (media distribution, not a
// website — see ADR-0001). Silence only that expected warning; let any other log through.
const realConsoleLog = console.log;
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].includes('AWS_SOLUTIONS_CONSTRUCTS_WARNING')) {
            return;
        }
        realConsoleLog(...args);
    });
});
afterAll(() => {
    jest.restoreAllMocks();
});

const regexHashedFileName = /[A-Fa-f0-9]{64}(\.[a-z]{3,4})$/;
const replaceHashedName = "[HASH REMOVED]$1";

expect.addSnapshotSerializer({
    test: (val) => typeof val === 'string' && regexHashedFileName.test(val),
    serialize: (val, config, indentation, depth, refs, printer) => {
        const replaced = val.replace(regexHashedFileName, replaceHashedName);
        return printer(replaced, config, indentation, depth, refs);
    }
});

const getTemplate = () => {
    const app = new App({ context: { solution_version: solutionVersion, email: 'test@example.com' } });
    const stack = new VodStack.VodFoundation(app, 'VOD');
    return Template.fromStack(stack);
};

test('VOD Foundation Stack Test', () => {
    expect(getTemplate().toJSON()).toMatchSnapshot();
});

test('creates a Step Functions state machine and three MediaConvert job templates', () => {
    const template = getTemplate();
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    template.resourceCountIs('AWS::MediaConvert::JobTemplate', 3);
});

test('triggers the workflow from an S3 Object Created EventBridge rule', () => {
    getTemplate().hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
            source: ['aws.s3'],
            'detail-type': ['Object Created']
        }
    });
});

test('records jobs in a DynamoDB table with a Guid partition key', () => {
    getTemplate().hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [{ AttributeName: 'Guid', KeyType: 'HASH' }]
    });
});

test('has no solution-authored Lambdas', () => {
    // The only remaining function is the CDK-managed S3 bucket-notifications handler
    // (inline ZipFile code) required by enableEventBridgeNotification(); the v1 job-submit,
    // job-complete, and custom-resource Lambdas are all gone. Deployment tracking is via the
    // (SO9673) Solution ID in the template description, not a custom-resource metrics call.
    getTemplate().resourceCountIs('AWS::Lambda::Function', 1);
});

describe('transcode-workflow.asl video-track selection', () => {
    // Regression guard: MediaConvert Probe does not guarantee the video track is Tracks[0]
    // (audio-first MP4s list audio at index 0). The tier/validation logic must locate the
    // video track by TrackType, not by a fixed index, or valid videos are wrongly rejected.
    const asl = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../lib/transcode-workflow.asl'), 'utf8')
    );
    const states = asl.States;

    test('normalizes video height by TrackType, not a fixed Tracks[] index', () => {
        const extract = states['Extract Video Metadata'];
        expect(extract).toBeDefined();
        // Selects the track whose TrackType is 'video' rather than assuming Tracks[0].
        expect(extract.Output).toContain("TrackType = 'video'");
        expect(extract.Output).toContain('videoHeight');
        expect(states['Probe'].Next).toBe('Extract Video Metadata');
    });

    test('Choice states read the normalized $.videoHeight, not Tracks[0]', () => {
        const choiceVars = [
            ...states['Check Video Track'].Choices,
            ...states['Choose Quality Tier'].Choices
        ].map((c: { Variable: string }) => c.Variable);

        // Every Choice must key off the normalized field...
        choiceVars.forEach((v: string) => expect(v).toBe('$.videoHeight'));
        // ...and must NOT reference the brittle fixed-index track path.
        const serialized = JSON.stringify([states['Check Video Track'], states['Choose Quality Tier']]);
        expect(serialized).not.toContain('Tracks[0]');
    });

    test('tier boundaries: 720p is HD, not SD (SD is strictly below 720)', () => {
        // Resolve which tier a given source height maps to, mirroring the Choice logic.
        const tierFor = (height: number): string => {
            for (const c of states['Choose Quality Tier'].Choices) {
                if (c.NumericLessThan !== undefined && height < c.NumericLessThan) return c.Next;
                if (c.NumericLessThanEquals !== undefined && height <= c.NumericLessThanEquals) return c.Next;
                if (c.NumericGreaterThanEquals !== undefined && height >= c.NumericGreaterThanEquals) return c.Next;
            }
            return states['Choose Quality Tier'].Default;
        };

        expect(tierFor(480)).toBe('Encode SD');
        expect(tierFor(576)).toBe('Encode SD');
        expect(tierFor(719)).toBe('Encode SD');
        expect(tierFor(720)).toBe('Encode HD');   // 720p (1280x720) is HD — regression guard
        expect(tierFor(1080)).toBe('Encode HD');
        expect(tierFor(1439)).toBe('Encode HD');
        expect(tierFor(1440)).toBe('Encode UHD');
        expect(tierFor(2160)).toBe('Encode UHD');
    });
});
