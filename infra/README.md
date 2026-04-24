# Konductor — AWS Infrastructure (POC)

This is the minimum infrastructure setup to run Konductor in the cloud for the purposes of a proof-of-concept. It is not the only way to deploy Konductor, but it's the simplest path to a working cloud deployment with HTTPS, persistent storage, and automated deploys.

There are many ways to host a Node.js container — ECS Fargate, EKS, Lambda, a plain EC2 instance, or even a non-AWS provider. This setup uses **AWS App Runner** because it eliminates the most operational overhead: no VPC, no ALB, no NAT gateways, no security groups, no EFS mount targets. App Runner gives you a container with built-in HTTPS and an auto-generated domain for roughly $5–10/month.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Internet                                                    │
│                                                              │
│  Kiro IDE ──── HTTPS/SSE ────┐                               │
│  Browser (Baton) ── HTTPS ───┤                               │
│  File Watcher ── HTTPS/REST ─┤                               │
└──────────────────────────────┼───────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────┐
│  AWS                         ▼                               │
│                                                              │
│  ┌─────────────────────────────────────────────┐             │
│  │  App Runner Service                         │             │
│  │  ─────────────────────────────────────────  │             │
│  │  Konductor MCP Server                       │             │
│  │  0.25 vCPU / 512 MB                         │             │
│  │  HTTPS auto-provisioned (*.awsapprunner.com)│             │
│  │  Health check: GET /health every 30s        │             │
│  └──────────┬──────────────────┬───────────────┘             │
│             │                  │                             │
│             ▼                  ▼                             │
│  ┌──────────────────┐  ┌──────────────────────┐             │
│  │  S3 Bucket        │  │  SSM Parameter Store │             │
│  │  sessions.json    │  │  /konductor/api-key  │             │
│  │  settings.json    │  │  /konductor/github-  │             │
│  │  history-users.   │  │    token             │             │
│  │    json           │  └──────────────────────┘             │
│  │  query-log.json   │                                       │
│  └──────────────────┘                                        │
│                                                              │
│  ┌──────────────────┐                                        │
│  │  ECR Registry     │◄──── GitHub Actions pushes images     │
│  │  konductor:latest │                                       │
│  └──────────────────┘                                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## What This Stack Provisions

| Resource | Purpose | Configuration |
|----------|---------|---------------|
| ECR Repository | Docker image registry | Scan on push, retain 5 images |
| S3 Bucket | Persistent storage (sessions, settings, history, query log) | Versioned, 30-day old version expiry, block all public access |
| App Runner Service | Runs the Konductor container | 0.25 vCPU, 512 MB, HTTPS auto-provisioned, health check on `/health` |
| SSM Parameters | Secrets (API key, GitHub token) | SecureString, injected as env vars at runtime |
| IAM Roles | Access control | Instance role (S3 + SSM read), Access role (ECR pull) |

## Estimated Monthly Cost

| Resource | Estimate |
|----------|----------|
| App Runner (0.25 vCPU, 512 MB, always-on) | ~$5–10/mo |
| S3 (< 1 MB of JSON files) | ~$0.01/mo |
| ECR (< 500 MB images) | ~$0.50/mo |
| SSM Parameter Store | Free tier |
| **Total** | **~$6–11/mo** |

## Prerequisites

Before deploying, you need:

- **AWS CLI v2** installed and configured
- **Node.js 20+** and npm
- **Docker** installed and running (for local image builds, or let GitHub Actions handle it)
- An **AWS account** with permissions to create the resources above
- A **GitHub Personal Access Token** (if using GitHub integration for PR/commit polling)

## Setup Guide

Do these steps in order. Steps 1–8 are one-time setup. After that, pushes to `main` deploy automatically.

### Step 1: Install AWS CLI

```bash
# macOS
brew install awscli

# Verify
aws --version
```

### Step 2: Create a Deployment IAM User

You need an IAM user (or role) with permissions for all the resources CDK provisions. This user's credentials are also used by GitHub Actions.

1. Go to **IAM → Users → Create user**
2. Name: `konductor-deployer`
3. Attach these managed policies (broad for POC — tighten for production):
   - `AmazonEC2ContainerRegistryFullAccess`
   - `AmazonS3FullAccess`
   - `AmazonSSMFullAccess`
   - `AWSAppRunnerFullAccess`
   - `IAMFullAccess` (CDK needs this to create roles)
   - `AWSCloudFormationFullAccess`
4. Create an **access key** (CLI use case) and save the credentials

If you already have an admin-level IAM user or SSO profile, you can use that instead.

### Step 3: Configure AWS CLI

```bash
aws configure
# Enter: Access Key ID, Secret Access Key, region (e.g. us-west-1), output format (json)

# Verify
aws sts get-caller-identity
```

### Step 4: Choose Your API Key

Pick a strong API key that MCP clients will use to authenticate:

```bash
openssl rand -hex 32
```

Save this — you'll need it for SSM and for client configuration.

### Step 5: Create a GitHub Personal Access Token (optional)

Only needed if you want Konductor to poll GitHub for PRs and commits.

1. Go to https://github.com/settings/tokens → Fine-grained tokens
2. Grant repository access to the repos you want to monitor
3. Permissions: `Contents: Read`, `Pull requests: Read`, `Metadata: Read`
4. Copy the token

### Step 6: Create SSM Parameters

These store your secrets in AWS. The CDK stack references them but does not create them — you must create them manually before deploying.

```bash
# Store the API key (required)
aws ssm put-parameter \
  --name "/konductor/api-key" \
  --type SecureString \
  --value "YOUR_API_KEY_FROM_STEP_4"

# Store the GitHub token (optional — skip if not using GitHub integration)
aws ssm put-parameter \
  --name "/konductor/github-token" \
  --type SecureString \
  --value "YOUR_GITHUB_PAT_FROM_STEP_5"
```

Verify:

```bash
aws ssm get-parameter --name "/konductor/api-key" --with-decryption --query "Parameter.Value" --output text
```

To update later:

```bash
aws ssm put-parameter --name "/konductor/api-key" --type SecureString --value "NEW_VALUE" --overwrite
```

### Step 7: Bootstrap CDK

CDK needs a one-time bootstrap per account/region. This creates an S3 bucket and IAM roles that CDK uses internally.

```bash
cd infra
npm install
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/$(aws configure get region)
```

You should see: `Environment aws://<account>/<region> bootstrapped.`

### Step 8: Deploy the Stack

```bash
# Preview what will be created
npx cdk diff

# Deploy (confirm the IAM changes when prompted)
npx cdk deploy
```

Deployment takes 3–5 minutes. When done, CDK outputs:

- `EcrRepositoryUri` — where to push Docker images
- `ServiceUrl` — the App Runner HTTPS URL
- `S3BucketName` — the persistence bucket

Save the `ServiceUrl` — that's your production Konductor address.

### Step 9: Build and Push the Docker Image

If you're not using GitHub Actions for CI/CD, push the first image manually:

```bash
# From the repo root (not konductor/)
ECR_URI=$(aws cloudformation describe-stacks --stack-name KonductorStack \
  --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" --output text)

# Authenticate Docker to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URI

# Build (context is repo root, Dockerfile is in konductor/)
docker build -f konductor/Dockerfile -t konductor .

# Tag and push
docker tag konductor:latest $ECR_URI:latest
docker push $ECR_URI:latest
```

Then trigger a deployment:

```bash
SERVICE_ARN=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='konductor'].ServiceArn" --output text)
aws apprunner start-deployment --service-arn $SERVICE_ARN
```

### Step 10: Set the External URL

After the first deploy, App Runner assigns a URL (e.g. `https://abc123.us-west-1.awsapprunner.com`). The server needs this to generate correct install commands, dashboard links, and MCP responses.

Get the URL:

```bash
aws cloudformation describe-stacks --stack-name KonductorStack \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" --output text
```

The CDK stack passes this as `KONDUCTOR_EXTERNAL_URL` to the container. On the first deploy, this value isn't known yet (chicken-and-egg), so the GitHub Actions workflow updates it after the initial deployment. If deploying manually, you may need to update the App Runner service configuration to include this env var.

### Step 11: Verify

```bash
SERVICE_URL=$(aws cloudformation describe-stacks --stack-name KonductorStack \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" --output text)

# Health check
curl $SERVICE_URL/health
# → {"status":"ok"}

# Check the installer bundle is served
curl -sI $SERVICE_URL/bundle/installer.tgz | head -5
# → HTTP/2 200 ... content-type: application/gzip
```

### Step 12: Add GitHub Actions Secrets

Go to your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | Access key from Step 2 |
| `AWS_SECRET_ACCESS_KEY` | Secret key from Step 2 |
| `AWS_REGION` | Your target region (e.g. `us-west-1`) |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account ID |

After this, pushes to `main` will automatically test, build, push, and deploy.

## Connecting Clients to the Production Server

Once deployed, teammates connect from any workspace:

```bash
npx $SERVICE_URL/bundle/installer.tgz --server $SERVICE_URL --api-key YOUR_API_KEY
```

Or configure MCP manually in `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "konductor": {
      "url": "https://abc123.us-west-1.awsapprunner.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
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

Replace the URL and API key with your actual values.

## GitHub Actions CI/CD Pipeline

The repository includes a GitHub Actions workflow at `.github/workflows/deploy.yml` that automates the full build-test-deploy cycle.

### What It Does

1. **Test** — runs `npm test` in `konductor/`
2. **Build** — builds the Docker image from the repo root
3. **Push** — tags with git SHA + `latest`, pushes to ECR
4. **Deploy** — triggers App Runner to pull the new image

### Triggers

- **Automatic**: every push to `main`
- **Manual**: `workflow_dispatch` (click "Run workflow" in the Actions tab)

### Client Bundle Lifecycle

When you push code changes (including changes to `konductor-setup/`):

1. GitHub Actions builds a new Docker image containing the latest `konductor-setup/` source
2. App Runner deploys the new container
3. On startup, the server packs `konductor-setup/` into a tarball and serves it at `/bundle/installer.tgz`
4. Connected file watchers detect the version mismatch on their next poll (every 10s by default)
5. File watchers download the new bundle and self-update automatically

No manual client updates needed.

## How Persistence Works

Locally, Konductor writes JSON files to disk. In the cloud, the `KONDUCTOR_S3_BUCKET` environment variable switches the server to S3-backed persistence.

| File | S3 Key | Content |
|------|--------|---------|
| `sessions.json` | `konductor/sessions.json` | Active work sessions |
| `settings.json` | `konductor/settings.json` | Admin settings |
| `history-users.json` | `konductor/history-users.json` | User history and metadata |
| `query-log.json` | `konductor/query-log.json` | Baton query log |

The S3 persistence layer:
- Loads all data from S3 on startup (missing keys → empty defaults)
- Flushes dirty data to S3 every 30 seconds
- Does a final flush on SIGTERM (graceful shutdown)
- Uses the App Runner instance role for S3 access — no credentials in the container

Data survives container restarts, deploys, and scaling events. S3 versioning is enabled so you can recover from accidental overwrites.

## Updating the Stack

To change infrastructure (e.g. increase CPU/memory, add env vars):

```bash
cd infra

# Edit lib/konductor-stack.ts

# Preview changes
npx cdk diff

# Apply
npx cdk deploy
```

## Tearing Down

```bash
cd infra
npx cdk destroy
```

The S3 bucket and ECR repository are set to `RETAIN` — they survive stack deletion. Delete them manually if you want a clean slate:

```bash
# Empty and delete the S3 bucket
aws s3 rb s3://konductor-data-$(aws sts get-caller-identity --query Account --output text) --force

# Delete the ECR repository
aws ecr delete-repository --repository-name konductor --force
```

## Running Tests

The CDK stack has unit tests that verify the synthesized CloudFormation template:

```bash
cd infra
npm test
```

## Alternatives to This Setup

This POC uses App Runner for simplicity. Here are other options if your needs differ:

| Approach | Pros | Cons |
|----------|------|------|
| **App Runner** (this setup) | Simplest, built-in HTTPS, no VPC/ALB needed, ~$6/mo | No WebSocket support (SSE only), limited config options |
| **ECS Fargate + ALB** | Full control, WebSocket support, custom domains with ACM | More complex (~$30/mo with ALB + NAT), VPC management |
| **EC2 instance** | Cheapest for always-on, full OS access | Manual patching, no auto-scaling, manual HTTPS setup |
| **Lambda + API Gateway** | Pay-per-request, scales to zero | Cold starts, 29s timeout (bad for SSE), complex packaging |
| **Non-AWS** (Railway, Fly.io, Render) | Simple deploys, built-in HTTPS | Vendor lock-in, less control over networking |

For a production deployment with custom domains, WebSocket support, or multi-region, consider upgrading to ECS Fargate + ALB.

## Quick Reference

```bash
# Get the service URL
aws cloudformation describe-stacks --stack-name KonductorStack \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" --output text

# Get the ECR URI
aws cloudformation describe-stacks --stack-name KonductorStack \
  --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" --output text

# Get the S3 bucket name
aws cloudformation describe-stacks --stack-name KonductorStack \
  --query "Stacks[0].Outputs[?OutputKey=='S3BucketName'].OutputValue" --output text

# Health check
curl $(aws cloudformation describe-stacks --stack-name KonductorStack \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" --output text)/health

# View App Runner logs
aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='konductor']"

# Update SSM secrets
aws ssm put-parameter --name "/konductor/api-key" --type SecureString --value "NEW_KEY" --overwrite

# Force a new deployment
SERVICE_ARN=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='konductor'].ServiceArn" --output text)
aws apprunner start-deployment --service-arn $SERVICE_ARN

# Tear down
cd infra && npx cdk destroy
```
# Konductor AWS Infrastructure

AWS CDK stack that deploys the Konductor MCP Server to App Runner with S3 persistence.

## Architecture

- **App Runner**: Container hosting with built-in HTTPS (`*.awsapprunner.com`)
- **ECR**: Docker image registry
- **S3**: Persistent storage for sessions, settings, history, query log
- **SSM Parameter Store**: Secrets (API key, GitHub token)
- **GitHub Actions**: CI/CD pipeline (test → build → push → deploy)

## Prerequisites

- AWS CLI configured (`aws configure`)
- Node.js 20+
- npm
- Docker (for local builds)

## Deployment Checklist

### 1. Create SSM Parameters

```bash
aws ssm put-parameter --name "/konductor/api-key" --type SecureString --value "<your-api-key>"
aws ssm put-parameter --name "/konductor/github-token" --type SecureString --value "<your-github-pat>"
```

### 2. Bootstrap CDK

```bash
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-west-1
```

### 3. Deploy the Stack

```bash
cd infra
npm install
npx cdk diff
npx cdk deploy
```

### 4. Push Initial Docker Image

The App Runner service needs an image in ECR before it can start. After the first `cdk deploy`:

```bash
ECR_URI=$(aws cloudformation describe-stacks --stack-name KonductorStack --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" --output text)
aws ecr get-login-password --region us-west-1 | docker login --username AWS --password-stdin $ECR_URI
docker build -t $ECR_URI:latest -f konductor/Dockerfile .
docker push $ECR_URI:latest
```

### 5. Verify

```bash
SERVICE_URL=$(aws cloudformation describe-stacks --stack-name KonductorStack --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" --output text)
curl $SERVICE_URL/health
```

### 6. Add GitHub Actions Secrets

In your repo: Settings → Secrets → Actions:

| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `AWS_REGION` | `us-west-1` |
| `AWS_ACCOUNT_ID` | Your 12-digit account ID |

After this, every push to `main` auto-deploys.

## MCP Client Configuration

Point your MCP client at the App Runner URL:

```json
{
  "mcpServers": {
    "konductor": {
      "url": "https://<app-runner-url>/sse",
      "env": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```

## npx Installer

```bash
npx https://<app-runner-url>/bundle/installer.tgz --server https://<app-runner-url>
```

## Client Bundle Lifecycle

1. Code pushed to `main`
2. GitHub Actions builds Docker image (includes latest `konductor-setup/`)
3. App Runner deploys new container
4. Server packs `konductor-setup/` and serves at `/bundle/installer.tgz`
5. File watchers detect version mismatch on next poll
6. Watchers download new bundle and self-update

## Useful Commands

```bash
npx cdk diff        # Preview changes
npx cdk deploy      # Deploy stack
npx cdk destroy     # Tear down stack
npx cdk synth       # Emit CloudFormation template
```
