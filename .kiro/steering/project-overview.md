# iSpot AI Project Overview

## System Architecture
- **Production-ready** three-tier microservices with async concurrency
- **Web Server** (FastAPI): Authentication, UI, conversation management
- **MCP Server** (Python): Snowflake Cortex agent orchestration  
- **Title Service** (FastAPI): AI-powered conversation title generation
- **Docker containerized** with docker-compose orchestration

## Key Technologies
- **Backend**: Python 3.8+, FastAPI, asyncio, bcrypt, JWT
- **Frontend**: Vanilla JS, Vega-Lite charts, responsive CSS
- **Database**: Snowflake (via Cortex agents), YAML config files
- **Authentication**: Multi-user with role-based access (web/cli/admin)
- **AI Integration**: Snowflake Cortex agents, OpenAI (title generation)

## Core Features
- **Multi-user authentication** with secure sessions
- **AI Personas** (CMO, Data Scientist, Growth, Marketing Analytics)
- **Smart conversation titles** via dedicated Title Service
- **Prompt templates** with parameter customization
- **CLI with batch processing** (CSV/JSON modes)
- **SSH server** for remote access
- **Admin panel** for user/agent/persona/template management

## File Structure
- `web/` - Frontend and web server
- `mcp_server/` - MCP protocol server
- `title_service/` - AI title generation service
- `cli/` - Command-line interface
- `shared/` - Common utilities
- `data/` - Configuration (users.yaml, agents.yaml, extra_config.json)
- `prompts/` - Template definitions by agent
- `docs/` - Comprehensive documentation
