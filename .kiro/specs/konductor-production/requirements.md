# Requirements Document

## Introduction

Phase 7 of the Konductor project moves the server from a locally-hosted development tool to a production-grade AWS deployment. The Konductor is containerized and deployed on ECS Fargate with persistent storage, HTTPS termination, health monitoring, and centralized logging. This phase ensures the Konductor is reliable, scalable, and accessible to all team members without depending on a single engineer's machine.

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk
- **ECS Fargate**: AWS container orchestration service that runs containers without managing servers
- **EFS (Elastic File System)**: AWS managed file storage that provides persistent volumes for containers
- **ALB (Application Load Balancer)**: AWS load balancer that provides HTTPS termination and routing

## Requirements

### Requirement 1

**User Story:** As a team lead, I want the Konductor deployed as a containerized service on AWS, so that the team has reliable access without depending on a single engineer's machine.

#### Acceptance Criteria

1. THE Konductor project SHALL include a Dockerfile that builds a production-ready container image
2. THE Konductor project SHALL include infrastructure-as-code (CDK or CloudFormation) that provisions ECS Fargate, EFS, and ALB resources
3. WHEN the container starts, THE Konductor SHALL perform a health check and report readiness within 30 seconds
4. WHEN the container is replaced or restarted, THE Konductor SHALL restore session data from EFS-backed persistent storage

### Requirement 2

**User Story:** As a software engineer, I want to connect to the production Konductor over HTTPS, so that my session data is transmitted securely.

#### Acceptance Criteria

1. THE ALB SHALL terminate TLS and forward traffic to the Konductor container over HTTP
2. WHEN an MCP client connects via SSE, THE connection SHALL be routed through the ALB with appropriate timeout settings for long-lived SSE connections
3. WHEN the Baton dashboard is accessed, THE ALB SHALL serve the dashboard over HTTPS

### Requirement 3

**User Story:** As a team lead, I want health monitoring and alerting for the Konductor, so that I am notified if the service becomes unavailable.

#### Acceptance Criteria

1. THE Konductor SHALL expose a `/health` endpoint that returns the server status, active session count, and uptime
2. WHEN the health check fails, THE ECS service SHALL restart the container automatically
3. THE infrastructure SHALL include CloudWatch alarms for container health, error rates, and response latency

### Requirement 4

**User Story:** As a team lead, I want deployment documentation in the README, so that the infrastructure can be provisioned and updated by any team member.

#### Acceptance Criteria

1. WHEN the production deployment is implemented, THE README.md SHALL include a deployment section with prerequisites, provisioning steps, configuration, and troubleshooting
2. WHEN the README.md documents deployment, THE README.md SHALL include the required AWS permissions, environment variables, and estimated monthly cost
