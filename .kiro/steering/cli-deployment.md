---
inclusion: manual
---

# CLI & Deployment Guide

## CLI Features
- **Authentication**: Interactive prompts or -u/-p flags for credentials
- **Conversation mode**: Interactive REPL with slash commands (/help, /save, /export-table)
- **Batch processing**: CSV and JSON modes with parallel execution
- **Template integration**: List, info, and execute templates from CLI
- **SSH server**: Remote access on port 2222 with auto-authentication
- **ASCII rendering**: Tables and charts in terminal

## Deployment Options
- **Docker (Recommended)**: `./docker-start.sh` - all services containerized
- **Python**: `./start.sh` or `python scripts/start_full_system.py`
- **Individual services**: Start web, mcp, title services separately
- **Production**: Docker Compose with environment-specific configs

## Port Configuration
- **3000**: Web server (FastAPI + static files)
- **8001**: MCP server (Snowflake agent orchestration)
- **8002**: Title service (AI-powered title generation)
- **2222**: SSH server (CLI remote access)

## Environment Variables
- `OPENAI_API_KEY`: Required for title generation service
- `ENABLE_PERSONA_PROMPT_STUFFING`: Enable/disable persona system
- `JWT_SECRET_KEY`: Session token encryption (auto-generated if missing)
- `CORS_ORIGINS`: Allowed origins for production deployment

## Key Scripts
- `./docker-start.sh` - Start all Docker services
- `./start.sh` - Start all Python services
- `scripts/start_full_system.py` - Alternative startup script
- `scripts/manage_users.py` - User management CLI
- `scripts/start_ssh_server.py` - SSH server for remote CLI access
