# Requirements Document

## Introduction

Phase 7 of the Konductor project moves the server from a locally-hosted development tool to a production-grade AWS deployment. The Konductor is containerized and deployed on ECS Fargate with persistent storage (EFS), HTTPS termination (ALB), container image storage (ECR), secrets management (SSM Parameter Store), and centralized monitoring (CloudWatch). The infrastructure is defined as code using AWS CDK (TypeScript) to match the Konductor's language stack. This phase ensures the Konductor is reliable, secure, and accessible to all team members without depending on a single engineer's machine.

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk
- **ECS Fargate**: AWS container orchestration service that runs containers without managing underlying servers
- **EFS (Elastic File System)**: AWS managed network file storage that provides persistent volumes mountable by containers
- **ALB (Application Load Balancer)**: AWS Layer 7 load balancer that provides HTTPS termination, routing, and health checking
- **ECR (Elastic Container Registry)**: AWS managed Docker container image registry
- **SSM Parameter Store**: AWS service for storing configuration data and secrets
- **CDK (Cloud Development Kit)**: AWS infrastructure-as-code framework using TypeScript
- **ACM (AWS Certificate Manager)**: AWS service for provisioning and managing TLS certificates
- **SSE (Server-Sent Events)**: HTTP-based protocol for server-to-client streaming used by MCP transport
- **Baton Dashboard**: The Konductor's web-based real-time visualization of sessions and conflicts

## Requirements

### Requirement 1

**User Story:** As a DevOps engineer, I want a production-ready Docker container for the Konductor, so that the server can be deployed consistently across environments.

#### Acceptance Criteria

1. THE Konductor project SHALL include a multi-stage Dockerfile that compiles TypeScript in a build stage and produces a minimal Node.js Alpine production image
2. THE production Docker image SHALL install only production dependencies (excluding devDependencies)
3. THE Dockerfile SHALL define a health check command that verifies the `/health` endpoint responds successfully within 5 seconds
4. WHEN the container starts, THE Konductor SHALL be ready to accept connections within 30 seconds
5. THE Dockerfile SHALL expose port 3100 and configure the `KONDUCTOR_PROTOCOL` environment variable to `http` for ALB-terminated TLS

### Requirement 2

**User Story:** As a DevOps engineer, I want a container image registry on AWS, so that Docker images are stored securely and scanned for vulnerabilities.

#### Acceptance Criteria

1. THE infrastructure SHALL include an ECR repository named `konductor` with image scanning enabled on push
2. WHEN a new image is pushed, THE ECR repository SHALL scan the image for known vulnerabilities
3. THE infrastructure documentation SHALL include commands for authenticating Docker to ECR, building, tagging, and pushing images

### Requirement 3

**User Story:** As a DevOps engineer, I want secrets stored securely in AWS, so that API keys and tokens are not embedded in code or container images.

#### Acceptance Criteria

1. THE infrastructure SHALL store the Konductor API key in SSM Parameter Store as a SecureString at the path `/konductor/api-key`
2. THE infrastructure SHALL store the GitHub token in SSM Parameter Store as a SecureString at the path `/konductor/github-token`
3. WHEN the ECS task starts, THE container SHALL receive secrets as environment variables injected from SSM Parameter Store
4. THE infrastructure documentation SHALL include commands for creating and updating SSM parameters

### Requirement 4

**User Story:** As a team lead, I want the Konductor deployed on ECS Fargate with persistent storage, so that the team has reliable access and session data survives container restarts.

#### Acceptance Criteria

1. THE CDK stack SHALL provision a VPC with 2 availability zones and 1 NAT gateway
2. THE CDK stack SHALL provision an ECS Fargate service running 1 task with 0.25 vCPU and 512 MB memory
3. THE CDK stack SHALL provision an encrypted EFS file system mounted at `/data` inside the container for persistent session storage
4. THE EFS file system SHALL use a POSIX access point with uid/gid 1000 and path `/konductor`
5. WHEN the container is replaced or restarted, THE Konductor SHALL restore session data from the EFS-mounted `/data` directory
6. THE EFS file system SHALL use a RETAIN removal policy so that session data survives stack teardowns

### Requirement 5

**User Story:** As a software engineer, I want to connect to the production Konductor over HTTPS, so that my session data is transmitted securely.

#### Acceptance Criteria

1. THE CDK stack SHALL provision an internet-facing Application Load Balancer that terminates TLS
2. THE ALB SHALL set its idle timeout to 3600 seconds to support long-lived SSE connections
3. THE ALB target group SHALL health-check the Konductor on the `/health` endpoint every 30 seconds
4. THE ALB target group SHALL use a deregistration delay of 10 seconds
5. WHEN an ACM certificate is available, THE ALB SHALL serve traffic on port 443 with the certificate attached
6. WHEN no ACM certificate is available, THE ALB SHALL serve traffic on port 80 for initial testing

### Requirement 6

**User Story:** As a team lead, I want health monitoring and alerting for the Konductor, so that I am notified when the service becomes unavailable or errors spike.

#### Acceptance Criteria

1. THE CDK stack SHALL provision a CloudWatch log group at `/ecs/konductor` with 30-day retention
2. THE CDK stack SHALL provision a CloudWatch alarm that triggers when the UnHealthyHostCount exceeds 0 for 2 consecutive 1-minute evaluation periods
3. THE CDK stack SHALL provision a CloudWatch alarm that triggers when the 5xx error count exceeds 10 in a 5-minute period
4. WHEN the health check fails, THE ECS service SHALL restart the container automatically

### Requirement 7

**User Story:** As a team lead, I want infrastructure defined as code using AWS CDK, so that the deployment is reproducible and version-controlled.

#### Acceptance Criteria

1. THE infrastructure project SHALL be initialized as a CDK TypeScript application in an `infra/` directory
2. THE CDK stack SHALL provision all resources (VPC, ECS, EFS, ALB, CloudWatch, ECR references, SSM references) in a single stack
3. THE CDK stack SHALL output the ALB DNS name and the full Konductor URL as CloudFormation outputs
4. THE infrastructure documentation SHALL include commands for bootstrapping CDK, previewing changes with `cdk diff`, and deploying with `cdk deploy`

### Requirement 8

**User Story:** As a DevOps engineer, I want documented procedures for ongoing operations, so that any team member can deploy updates, view logs, and tear down the stack.

#### Acceptance Criteria

1. THE infrastructure documentation SHALL include a procedure for building, tagging, pushing a new image, and forcing an ECS redeployment
2. THE infrastructure documentation SHALL include a command for tailing CloudWatch logs
3. THE infrastructure documentation SHALL include a command for checking CloudWatch alarm states
4. THE infrastructure documentation SHALL include a procedure for tearing down the CDK stack and manually deleting the retained EFS file system

### Requirement 9

**User Story:** As a software engineer, I want to connect MCP clients and the npx installer to the production server, so that I can use Konductor from any workspace.

#### Acceptance Criteria

1. THE infrastructure documentation SHALL include an example MCP client configuration pointing at the production HTTPS URL with an Authorization header
2. THE infrastructure documentation SHALL include an example npx installer command pointing at the production server URL
3. WHEN HTTPS is enabled, THE documentation SHALL instruct users to update their MCP config URLs from `http://` to `https://`

### Requirement 10

**User Story:** As a team lead, I want a checklist of all deployment steps, so that I can track progress and verify nothing is missed.

#### Acceptance Criteria

1. THE infrastructure documentation SHALL include a checklist covering: AWS CLI configuration, ECR creation, Dockerfile testing, image push, SSM secrets, CDK initialization, CDK stack deployment, health check verification, ACM certificate, HTTPS enablement, DNS configuration, client updates, and alarm verification
