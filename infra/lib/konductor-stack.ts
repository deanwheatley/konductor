import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apprunner from "aws-cdk-lib/aws-apprunner";
import { Construct } from "constructs";

export class KonductorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Secrets passed via CDK context (--context apiKey=xxx --context githubToken=xxx)
    const apiKey = this.node.tryGetContext("apiKey") ?? "";
    const githubToken = this.node.tryGetContext("githubToken") ?? "";

    // ── ECR Repository (import existing, created outside CDK) ──────
    const ecrRepo = ecr.Repository.fromRepositoryName(this, "KonductorRepo", "konductor");

    // ── S3 Bucket for persistence ──────────────────────────────────
    const dataBucket = new s3.Bucket(this, "KonductorData", {
      bucketName: `konductor-data-${this.account}`,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── IAM: Instance role (S3 access) ─────────────────────────────
    const instanceRole = new iam.Role(this, "KonductorInstanceRole", {
      assumedBy: new iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
    });
    dataBucket.grantReadWrite(instanceRole);

    // ── IAM: Access role (ECR pull) ────────────────────────────────
    const accessRole = new iam.Role(this, "KonductorAccessRole", {
      assumedBy: new iam.ServicePrincipal("build.apprunner.amazonaws.com"),
    });
    ecrRepo.grantPull(accessRole);

    // ── App Runner Service ─────────────────────────────────────────
    const service = new apprunner.CfnService(this, "KonductorService", {
      serviceName: "konductor",
      sourceConfiguration: {
        authenticationConfiguration: {
          accessRoleArn: accessRole.roleArn,
        },
        imageRepository: {
          imageIdentifier: `${ecrRepo.repositoryUri}:latest`,
          imageRepositoryType: "ECR",
          imageConfiguration: {
            port: "3100",
            runtimeEnvironmentVariables: [
              { name: "KONDUCTOR_PORT", value: "3100" },
              { name: "KONDUCTOR_PROTOCOL", value: "http" },
              { name: "KONDUCTOR_S3_BUCKET", value: dataBucket.bucketName },
              { name: "LOG_TO_TERMINAL", value: "true" },
              { name: "KONDUCTOR_API_KEY", value: apiKey },
              { name: "GITHUB_TOKEN", value: githubToken },
            ],
          },
        },
        autoDeploymentsEnabled: false,
      },
      instanceConfiguration: {
        cpu: "0.25 vCPU",
        memory: "0.5 GB",
        instanceRoleArn: instanceRole.roleArn,
      },
      healthCheckConfiguration: {
        protocol: "HTTP",
        path: "/health",
        interval: 20,
        timeout: 5,
        healthyThreshold: 1,
        unhealthyThreshold: 3,
      },
    });

    // App Runner needs the access role to exist before the service
    service.addDependency(accessRole.node.defaultChild as cdk.CfnResource);

    const serviceUrl = cdk.Fn.join("", ["https://", service.attrServiceUrl]);

    // ── Outputs ────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "EcrRepositoryUri", {
      value: ecrRepo.repositoryUri,
      description: "ECR repository URI for Docker image pushes",
    });

    new cdk.CfnOutput(this, "ServiceUrl", {
      value: serviceUrl,
      description: "App Runner service HTTPS URL",
    });

    new cdk.CfnOutput(this, "S3BucketName", {
      value: dataBucket.bucketName,
      description: "S3 bucket for Konductor data persistence",
    });
  }
}
