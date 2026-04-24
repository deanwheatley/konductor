import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { KonductorStack } from "../lib/konductor-stack";

function createTemplate(): Template {
  const app = new cdk.App();
  const stack = new KonductorStack(app, "TestStack", {
    env: { account: "123456789012", region: "us-west-1" },
  });
  return Template.fromStack(stack);
}

describe("KonductorStack CDK Assertions", () => {
  it("creates an ECR repository with scan on push", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::ECR::Repository", {
      RepositoryName: "konductor",
      ImageScanningConfiguration: { ScanOnPush: true },
    });
  });

  it("ECR repository has lifecycle rule retaining 5 images", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::ECR::Repository", {
      LifecyclePolicy: Match.objectLike({
        LifecyclePolicyText: Match.stringLikeRegexp("countNumber.*5"),
      }),
    });
  });

  it("creates an S3 bucket with versioning enabled", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
    });
  });

  it("S3 bucket blocks public access", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("creates App Runner service with correct CPU and memory", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::AppRunner::Service", {
      InstanceConfiguration: {
        Cpu: "0.25 vCPU",
        Memory: "0.5 GB",
      },
    });
  });

  it("App Runner service has health check on /health", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::AppRunner::Service", {
      HealthCheckConfiguration: Match.objectLike({
        Protocol: "HTTP",
        Path: "/health",
        Interval: 20,
      }),
    });
  });

  it("App Runner service uses port 3100", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::AppRunner::Service", {
      SourceConfiguration: Match.objectLike({
        ImageRepository: Match.objectLike({
          ImageConfiguration: Match.objectLike({
            Port: "3100",
          }),
        }),
      }),
    });
  });

  it("App Runner service has KONDUCTOR_S3_BUCKET env var", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::AppRunner::Service", {
      SourceConfiguration: Match.objectLike({
        ImageRepository: Match.objectLike({
          ImageConfiguration: Match.objectLike({
            RuntimeEnvironmentVariables: Match.arrayWith([
              Match.objectLike({ Name: "KONDUCTOR_S3_BUCKET" }),
            ]),
          }),
        }),
      }),
    });
  });

  it("App Runner service has SSM secrets for API key and GitHub token", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::AppRunner::Service", {
      SourceConfiguration: Match.objectLike({
        ImageRepository: Match.objectLike({
          ImageConfiguration: Match.objectLike({
            RuntimeEnvironmentSecrets: Match.arrayWith([
              Match.objectLike({ Name: "KONDUCTOR_API_KEY" }),
              Match.objectLike({ Name: "GITHUB_TOKEN" }),
            ]),
          }),
        }),
      }),
    });
  });

  it("creates IAM instance role for App Runner tasks", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: "tasks.apprunner.amazonaws.com" },
          }),
        ]),
      }),
    });
  });

  it("creates IAM access role for ECR pull", () => {
    const template = createTemplate();
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: "build.apprunner.amazonaws.com" },
          }),
        ]),
      }),
    });
  });

  it("outputs ECR repository URI", () => {
    const template = createTemplate();
    template.hasOutput("EcrRepositoryUri", {});
  });

  it("outputs App Runner service URL", () => {
    const template = createTemplate();
    template.hasOutput("ServiceUrl", {});
  });

  it("outputs S3 bucket name", () => {
    const template = createTemplate();
    template.hasOutput("S3BucketName", {});
  });
});
