# Konductor — AWS Infrastructure Setup (Phase 7)

This guide walks through setting up the production AWS infrastructure for the Konductor MCP Server: ECS Fargate for the container, EFS for persistent storage, ALB for HTTPS termination, ECR for container images, and CloudWatch for monitoring.

## Prerequisites

- AWS CLI v2 installed and configured (`aws configure`)
- AWS CDK v2 installed (`npm install -g aws-cdk`)
- Docker installed and running
- A registered domain name (or use the ALB's default DNS)
- An ACM certificate for your domain (if using a custom domain)
- Node.js 20+
- Sufficient AWS permissions: ECS, EFS, EC2 (VPC/ALB/SG), ECR, CloudWatch, SSM, ACM, IAM

## Estimated Monthly Cost

| Resource | Estimate |
|----------|----------|
| ECS Fargate (0.25 vCPU, 512MB, 24/7) | ~$9/mo |
| ALB (low traffic) | ~$18/mo |
| EFS (< 1GB) | ~$0.30/mo |
| CloudWatch Logs + Alarms | ~$2/mo |
| ECR (< 500MB images) | ~$0.50/mo |
| **Total** | **~$30/mo** |

---

## Step 1: Create the ECR Repository

This is where your Docker images will be stored.

```bash
aws ecr create-repository \
  --repository-name konductor \
  --image-scanning-configuration scanOnPush=true \
  --region us-east-1
```

Note the `repositoryUri` from the output — you'll need it later. It looks like:
`123456789012.dkr.ecr.us-east-1.amazonaws.com/konductor`

## Step 2: Create the Dockerfile

Create `konductor/Dockerfile`:

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY konductor.yaml ./

# EFS mount point for persistent data (sessions.json, logs)
RUN mkdir -p /data

ENV NODE_ENV=production
ENV KONDUCTOR_PORT=3100
ENV KONDUCTOR_DATA_DIR=/data
ENV KONDUCTOR_PROTOCOL=http

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/health').then(r => { if (!r.ok) process.exit(1) })"

CMD ["node", "dist/index.js"]
```

Note: `KONDUCTOR_PROTOCOL=http` because TLS is terminated at the ALB.

## Step 3: Build and Push the Docker Image

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# Build the image (from the konductor/ directory)
docker build -t konductor .

# Tag it
docker tag konductor:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/konductor:latest

# Push it
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/konductor:latest
```

Replace `123456789012` with your actual AWS account ID.

## Step 4: Store Secrets in SSM Parameter Store

```bash
# API key for SSE authentication
aws ssm put-parameter \
  --name "/konductor/api-key" \
  --type SecureString \
  --value "your-api-key-here"

# GitHub token (if using GitHub integration)
aws ssm put-parameter \
  --name "/konductor/github-token" \
  --type SecureString \
  --value "ghp_your_token_here"
```

## Step 5: Initialize the CDK Project

```bash
mkdir -p infra
cd infra
npx cdk init app --language typescript
```

Install the required CDK constructs:

```bash
npm install aws-cdk-lib constructs
```

## Step 6: Write the CDK Stack

Replace `infra/lib/infra-stack.ts` with the following. This provisions everything: VPC, EFS, ECS Fargate, ALB, CloudWatch.

```typescript
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";

export class KonductorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- VPC ---
    const vpc = new ec2.Vpc(this, "KonductorVpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    // --- EFS ---
    const fileSystem = new efs.FileSystem(this, "KonductorEfs", {
      vpc,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encrypted: true,
    });

    const accessPoint = fileSystem.addAccessPoint("KonductorAccessPoint", {
      path: "/konductor",
      createAcl: { ownerGid: "1000", ownerUid: "1000", permissions: "755" },
      posixUser: { gid: "1000", uid: "1000" },
    });

    // --- ECS Cluster ---
    const cluster = new ecs.Cluster(this, "KonductorCluster", { vpc });

    // --- Log Group ---
    const logGroup = new logs.LogGroup(this, "KonductorLogs", {
      logGroupName: "/ecs/konductor",
      retention: logs.RetentionDays.THIRTY_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- ECR Repository (import existing) ---
    const repository = ecr.Repository.fromRepositoryName(
      this, "KonductorRepo", "konductor"
    );

    // --- Secrets from SSM ---
    const apiKey = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, "ApiKey", { parameterName: "/konductor/api-key" }
    );
    const githubToken = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, "GithubToken", { parameterName: "/konductor/github-token" }
    );

    // --- Task Definition ---
    const taskDef = new ecs.FargateTaskDefinition(this, "KonductorTask", {
      cpu: 256,       // 0.25 vCPU
      memoryLimitMiB: 512,
    });

    // Mount EFS
    taskDef.addVolume({
      name: "konductor-data",
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: "ENABLED",
        authorizationConfig: { accessPointId: accessPoint.accessPointId, iam: "ENABLED" },
      },
    });

    const container = taskDef.addContainer("konductor", {
      image: ecs.ContainerImage.fromEcrRepository(repository, "latest"),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "konductor" }),
      environment: {
        KONDUCTOR_PORT: "3100",
        KONDUCTOR_DATA_DIR: "/data",
        KONDUCTOR_PROTOCOL: "http",
        NODE_ENV: "production",
      },
      secrets: {
        KONDUCTOR_API_KEY: ecs.Secret.fromSsmParameter(apiKey),
        GITHUB_TOKEN: ecs.Secret.fromSsmParameter(githubToken),
      },
      portMappings: [{ containerPort: 3100 }],
    });

    container.addMountPoints({
      sourceVolume: "konductor-data",
      containerPath: "/data",
      readOnly: false,
    });

    // --- ALB ---
    const alb = new elbv2.ApplicationLoadBalancer(this, "KonductorAlb", {
      vpc,
      internetFacing: true,
    });

    // IMPORTANT: Set idle timeout to 3600s for long-lived SSE connections
    alb.setAttribute("idle_timeout.timeout_seconds", "3600");

    // --- Fargate Service ---
    const service = new ecs.FargateService(this, "KonductorService", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: false,
    });

    // Allow EFS access from Fargate tasks
    fileSystem.connections.allowDefaultPortFrom(service);

    // --- HTTPS Listener ---
    // Option A: If you have an ACM certificate for your domain, uncomment this:
    //
    // const certificate = acm.Certificate.fromCertificateArn(
    //   this, "Cert", "arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id"
    // );
    // const httpsListener = alb.addListener("HttpsListener", {
    //   port: 443,
    //   certificates: [certificate],
    // });
    // httpsListener.addTargets("KonductorTarget", {
    //   port: 3100,
    //   targets: [service],
    //   healthCheck: { path: "/health", interval: cdk.Duration.seconds(30) },
    //   deregistrationDelay: cdk.Duration.seconds(10),
    // });

    // Option B: HTTP-only listener (for initial testing without a domain)
    const httpListener = alb.addListener("HttpListener", { port: 80 });
    httpListener.addTargets("KonductorTarget", {
      port: 3100,
      targets: [service],
      healthCheck: { path: "/health", interval: cdk.Duration.seconds(30) },
      deregistrationDelay: cdk.Duration.seconds(10),
    });

    // --- CloudWatch Alarms ---
    new cloudwatch.Alarm(this, "UnhealthyHostAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApplicationELB",
        metricName: "UnHealthyHostCount",
        dimensionsMap: {
          LoadBalancer: alb.loadBalancerFullName,
          TargetGroup: httpListener.defaultAction
            ? alb.loadBalancerFullName
            : "",
        },
        statistic: "Maximum",
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      alarmDescription: "Konductor container is unhealthy",
    });

    new cloudwatch.Alarm(this, "5xxErrorAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApplicationELB",
        metricName: "HTTPCode_Target_5XX_Count",
        dimensionsMap: { LoadBalancer: alb.loadBalancerFullName },
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: "Konductor is returning 5xx errors",
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: "ALB DNS name — point your domain here or use directly",
    });

    new cdk.CfnOutput(this, "KonductorUrl", {
      value: `http://${alb.loadBalancerDnsName}`,
      description: "Konductor server URL (switch to https:// after adding cert)",
    });
  }
}
```

## Step 7: Deploy the CDK Stack

```bash
cd infra

# First time only — bootstrap CDK in your AWS account/region
npx cdk bootstrap

# Preview what will be created
npx cdk diff

# Deploy
npx cdk deploy
```

The deploy takes ~5-10 minutes. When done, it outputs the ALB DNS name.

## Step 8: Verify the Deployment

```bash
# Get the ALB URL from the CDK output
ALB_URL="http://<alb-dns-name-from-output>"

# Health check
curl $ALB_URL/health

# Should return: {"status":"ok"}
```

## Step 9: Add HTTPS (When Ready)

1. Request an ACM certificate for your domain:
   ```bash
   aws acm request-certificate \
     --domain-name konductor.yourdomain.com \
     --validation-method DNS
   ```
2. Complete DNS validation (add the CNAME record ACM gives you)
3. In the CDK stack, uncomment Option A (HTTPS listener) and comment out Option B (HTTP listener)
4. Add a CNAME or alias record pointing `konductor.yourdomain.com` → ALB DNS name
5. Redeploy: `npx cdk deploy`

## Step 10: Connect Clients to Production

Update your MCP config to point at the production URL:

```json
{
  "mcpServers": {
    "konductor": {
      "url": "https://konductor.yourdomain.com/sse",
      "headers": {
        "Authorization": "Bearer your-api-key-here"
      },
      "autoApprove": [
        "register_session", "check_status", "deregister_session",
        "list_sessions", "who_is_active", "who_overlaps",
        "user_activity", "risk_assessment", "repo_hotspots",
        "active_branches", "coordination_advice",
        "client_install_info", "client_update_check"
      ]
    }
  }
}
```

Or use the npx installer pointed at the production server:

```bash
npx https://konductor.yourdomain.com/bundle/installer.tgz \
  --server https://konductor.yourdomain.com \
  --api-key your-api-key-here
```

---

## Ongoing Operations

### Deploying a New Version

```bash
# Build, tag, push new image
cd konductor
docker build -t konductor .
docker tag konductor:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/konductor:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/konductor:latest

# Force ECS to pull the new image
aws ecs update-service \
  --cluster KonductorCluster \
  --service KonductorService \
  --force-new-deployment
```

### Viewing Logs

```bash
aws logs tail /ecs/konductor --follow
```

### Checking Alarms

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix "Konductor" \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue}'
```

### Tearing Down

```bash
cd infra
npx cdk destroy
```

Note: EFS is set to `RETAIN` so your session data survives a stack teardown. Delete it manually if you want a clean slate:
```bash
aws efs delete-file-system --file-system-id fs-xxxxxxxx
```

---

## Checklist

- [ ] AWS CLI configured with correct account/region
- [ ] ECR repository created
- [ ] Dockerfile created and tested locally (`docker build` + `docker run`)
- [ ] Image pushed to ECR
- [ ] Secrets stored in SSM Parameter Store
- [ ] CDK project initialized
- [ ] CDK stack written
- [ ] `cdk deploy` successful
- [ ] Health check passes via ALB URL
- [ ] ACM certificate requested and validated (for HTTPS)
- [ ] HTTPS listener enabled in CDK stack
- [ ] DNS record pointing to ALB
- [ ] Clients updated to use production URL
- [ ] CloudWatch alarms verified
