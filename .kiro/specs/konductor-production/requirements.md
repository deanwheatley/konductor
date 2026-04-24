# Requirements Document

## Introduction

This spec deploys the Konductor MCP Server to AWS as a POC using App Runner for compute and S3 for persistent storage. App Runner provides built-in HTTPS with an auto-generated domain, automatic scaling, and container deployment from ECR — eliminating the need for ALB, VPC, Route 53, ACM, and EFS. GitHub Actions automates the build-test-deploy pipeline on every push to `main`. The infrastructure is defined using AWS CDK (TypeScript) and lives in the existing `deanwheatley/konductor` GitHub repository.

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk
- **App Runner**: AWS fully managed container service that provides built-in HTTPS, auto-scaling, and deployment from ECR
- **ECR (Elastic Container Registry)**: AWS managed Docker container image registry
- **S3 (Simple Storage Service)**: AWS object storage used for persisting session and settings data
- **SSM Parameter Store**: AWS service for storing configuration data and secrets
- **CDK (Cloud Development Kit)**: AWS infrastructure-as-code framework using TypeScript
- **SSE (Server-Sent Events)**: HTTP-based protocol for server-to-client streaming used by MCP transport
- **GitHub Actions**: CI/CD platform integrated with GitHub for automated build and deploy workflows
- **Client Bundle**: A tarball (`.tgz`) containing the file watcher, steering rules, hooks, and installer script distributed to MCP clients

## Requirements

### Requirement 1

**User Story:** As a developer, I want a Docker container for the Konductor, so that the server can be deployed to App Runner.

#### Acceptance Criteria

1. THE Konductor project SHALL include a multi-stage Dockerfile that compiles TypeScript in a build stage and produces a minimal Node.js 20 Alpine production image
2. THE production Docker image SHALL install only production dependencies (excluding devDependencies)
3. THE Dockerfile SHALL define a health check command that verifies the `/health` endpoint responds successfully within 5 seconds
4. THE Dockerfile SHALL expose port 3100 and set `KONDUCTOR_PROTOCOL=http` since TLS is terminated by App Runner
5. THE Dockerfile SHALL copy the `konductor-setup/` directory into the image so the server can pack and serve installer bundles at startup
6. THE Dockerfile SHALL set the working directory to `/app/konductor` so the server finds `package.json`, `konductor.yaml`, and relative paths correctly

### Requirement 2

**User Story:** As a developer, I want secrets stored in AWS SSM Parameter Store, so that API keys and tokens are not embedded in code or images.

#### Acceptance Criteria

1. THE infrastructure SHALL store the Konductor API key in SSM Parameter Store as a SecureString at the path `/konductor/api-key`
2. THE infrastructure SHALL store the GitHub token in SSM Parameter Store as a SecureString at the path `/konductor/github-token`
3. WHEN the App Runner service starts, THE container SHALL receive secrets as environment variables sourced from SSM Parameter Store
4. THE infrastructure README SHALL include commands for creating and updating SSM parameters

### Requirement 3

**User Story:** As a developer, I want session and settings data persisted to S3, so that data survives container restarts and deploys.

#### Acceptance Criteria

1. THE CDK stack SHALL provision an S3 bucket for Konductor data with versioning enabled and a lifecycle rule to expire old versions after 30 days
2. THE Konductor server SHALL persist `sessions.json`, `settings.json`, `history-users.json`, and `query-log.json` to the S3 bucket
3. WHEN the container starts, THE Konductor server SHALL load persisted data from S3 into memory
4. THE Konductor server SHALL write data to S3 on a periodic interval (every 30 seconds) and on graceful shutdown (SIGTERM)
5. THE S3 persistence layer SHALL use atomic writes (write to a temp key, then copy to final key) to prevent corruption from concurrent writes
6. THE Konductor container SHALL receive the S3 bucket name as the `KONDUCTOR_S3_BUCKET` environment variable

### Requirement 4

**User Story:** As a developer, I want to connect to the Konductor over HTTPS, so that MCP clients (Kiro IDE) can establish secure SSE connections.

#### Acceptance Criteria

1. THE CDK stack SHALL provision an App Runner service that provides built-in HTTPS with an auto-generated `*.awsapprunner.com` domain
2. THE App Runner service SHALL configure the health check on the `/health` endpoint with a 30-second interval
3. THE App Runner service SHALL set the instance configuration to 0.25 vCPU and 512 MB memory
4. THE CDK stack SHALL output the App Runner service URL as a CloudFormation output

### Requirement 5

**User Story:** As a developer, I want infrastructure defined as code using AWS CDK, so that the deployment is reproducible.

#### Acceptance Criteria

1. THE infrastructure project SHALL be a CDK TypeScript application in an `infra/` directory at the repository root
2. THE CDK stack SHALL provision all resources (App Runner service, ECR repository, S3 bucket, SSM references, IAM roles) in a single stack named `KonductorStack`
3. THE CDK stack SHALL create the ECR repository with image scanning enabled on push and a lifecycle rule retaining the 5 most recent images
4. THE CDK stack SHALL output the ECR repository URI and the App Runner service HTTPS URL
5. THE infrastructure README SHALL include commands for bootstrapping CDK, previewing changes with `cdk diff`, and deploying with `cdk deploy`

### Requirement 6

**User Story:** As a developer, I want the Konductor to automatically deploy when the main branch changes, so that the latest code is always running in AWS.

#### Acceptance Criteria

1. THE repository SHALL include a GitHub Actions workflow at `.github/workflows/deploy.yml` that triggers on pushes to the `main` branch
2. THE workflow SHALL run the existing test suite (`npm test` in the `konductor/` directory) before building the Docker image
3. THE workflow SHALL build the Docker image, authenticate to ECR, tag the image with the git SHA and `latest`, and push to ECR
4. THE workflow SHALL trigger an App Runner deployment after pushing the image so the running service picks up the new image
5. THE workflow SHALL use GitHub repository secrets for AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_ACCOUNT_ID`)
6. THE workflow SHALL include a manual trigger (`workflow_dispatch`) so developers can deploy on demand

### Requirement 7

**User Story:** As a developer, I want documentation for connecting MCP clients to the production server, so that teammates can use Konductor from any workspace.

#### Acceptance Criteria

1. THE infrastructure README SHALL include an example MCP client configuration pointing at the App Runner HTTPS URL with an Authorization header
2. THE infrastructure README SHALL include an example npx installer command pointing at the App Runner HTTPS URL
3. THE infrastructure README SHALL include a deployment checklist covering: AWS CLI setup, SSM secrets creation, CDK bootstrap, CDK deploy, health check verification, and client configuration

### Requirement 8

**User Story:** As a developer, I want the Konductor container to use an external URL configuration, so that install commands, dashboard links, and MCP responses use the correct public address.

#### Acceptance Criteria

1. WHEN `KONDUCTOR_EXTERNAL_URL` is set, THE Konductor server SHALL use the external URL value as the `serverUrl` for generating Baton dashboard URLs, installer commands, update URLs, and admin page URLs in MCP tool responses
2. THE CDK stack SHALL pass the App Runner service HTTPS URL as the `KONDUCTOR_EXTERNAL_URL` environment variable to the container
3. WHEN `KONDUCTOR_EXTERNAL_URL` is set, THE `main()` function SHALL use the external URL instead of deriving the URL from `osHostname()` and the local port

### Requirement 9

**User Story:** As a developer, I want the Konductor to include a `konductor.yaml` configuration file in the Docker image, so that the server starts with correct collision state rules and GitHub integration settings.

#### Acceptance Criteria

1. THE Dockerfile SHALL copy the `konductor.yaml` configuration file into the image at the working directory
2. THE `konductor.yaml` in the image SHALL include the GitHub integration section with `token_env: GITHUB_TOKEN` and the repository list
3. WHEN the container starts, THE Konductor SHALL read `konductor.yaml` from the working directory and configure collision states and GitHub polling accordingly

### Requirement 10

**User Story:** As a developer, I want new client bundles to be automatically built and distributed when the server is deployed, so that clients always get the latest installer.

#### Acceptance Criteria

1. THE GitHub Actions deploy workflow SHALL build the `konductor-setup` package as part of the Docker image build so the latest installer is included in every deployment
2. WHEN the Docker image starts, THE Konductor server SHALL pack the `konductor-setup/` directory and serve the resulting tarball at `/bundle/installer.tgz`
3. THE infrastructure README SHALL document the client bundle lifecycle: code change → merge to main → GitHub Actions builds image with latest konductor-setup → App Runner deploys new image → clients auto-update via the file watcher's version check
4. WHEN a client's file watcher detects a version mismatch, THE watcher SHALL download the new installer bundle from the server's `/bundle/installer.tgz` endpoint and self-update

### Requirement 11

**User Story:** As a developer, I want the S3 persistence layer to serialize and deserialize data correctly, so that no data is lost across container restarts.

#### Acceptance Criteria

1. THE S3 persistence layer SHALL serialize data as JSON before writing to S3
2. THE S3 persistence layer SHALL deserialize JSON data when loading from S3 on startup
3. THE S3 persistence layer SHALL handle missing S3 objects gracefully by starting with empty data structures on first deployment
4. THE S3 persistence layer SHALL provide a pretty-printer that serializes data to formatted JSON for debugging
5. THE S3 persistence layer SHALL round-trip data correctly: serializing then deserializing any valid data structure SHALL produce an equivalent object
