# iSpot AI - Technical Documentation for Claude

This document provides technical context for AI assistants working on the iSpot AI project.

## Project Overview

iSpot AI is a **production-ready, enterprise-grade** web-based chat interface for querying Snowflake Cortex AI agents using the Model Context Protocol (MCP). The system features full async concurrency, comprehensive security, multi-user authentication, and extensive testing coverage.

**Current Version**: 3.2.0  
**Architecture**: Three-tier microservices with async concurrency  
**Status**: Production-ready with 70+ test files  

### Key Characteristics
- **Async-First**: Full async/await implementation with exponential backoff retry
- **Security-Focused**: Multi-layer defense with comprehensive input validation
- **Modular Frontend**: 8 specialized JavaScript modules, no frameworks
- **Microservices**: Loosely coupled services with clear responsibilities
- **Comprehensive Testing**: Unit, integration, security, and property-based tests
- **Production-Ready**: Docker deployment with health checks and monitoring

---

## System Architecture

### High-Level Architecture
```
Browser (8 JS Modules) → Web Server (Flask) → MCP Server (FastAPI) → Title Service (FastAPI) → Snowflake Cortex
```

### Service Breakdown

#### 1. Web Server (Flask) - Port 3000
- **Purpose**: Frontend delivery, authentication, admin interface
- **Key Features**: JWT auth, admin panel, conversation storage, URL routing
- **Security**: CSRF protection, XSS prevention, rate limiting

#### 2. MCP Server (FastAPI) - Port 8001  
- **Purpose**: MCP protocol implementation, session management
- **Key Features**: Async Cortex client, SSE streaming, persona management
- **Concurrency**: Full async/await with session isolation

#### 3. Title Service (FastAPI) - Port 8002
- **Purpose**: AI-powered conversation title generation
- **Key Features**: Lightweight container (~50MB), health checks, fallback
- **Integration**: Uses MCP Server for AI title generation

#### 4. CLI Server (SSH) - Port 2222 (Optional)
- **Purpose**: Remote command-line access
- **Key Features**: PAM authentication, full CLI functionality