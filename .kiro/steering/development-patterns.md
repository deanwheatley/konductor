# Development Patterns & Standards

## System Startup

### Starting the Full System
To start all services (web server, MCP server, title service):
```bash
python3 start_full_system.py
```

This starts:
- Web Server (port 3000)
- MCP Server (port 8001)
- Title Service (port 8002)

### Alternative Startup Methods
- Docker: `./docker-start.sh` or `docker compose up`
- Individual services: `./start.sh` (Python only)

## Code Organization
- **Async/await** throughout - all I/O operations are async
- **FastAPI**: dependency injection, Pydantic models, proper HTTP status codes
- **Error handling**: Custom exceptions with HTTP responses
- **Security**: CSRF tokens, input sanitization, bcrypt passwords, JWT sessions

## Key Patterns
- **MCP Protocol**: Request/response with streaming support
- **Authentication**: JWT tokens in httpOnly cookies, role-based middleware
- **Configuration**: YAML files with hot-reload capability
- **File Operations**: Atomic writes (temp + rename), proper error handling

## Safe Deployment Strategy
- **Feature Flags**: All new features behind feature flags (default OFF)
- **Backward Compatible**: New features must not break existing functionality
- **Branch Isolation**: Develop on feature branches, merge to main when ready
- **Gradual Rollout**: Internal → 10% → 50% → 100% with monitoring at each stage
- **Instant Rollback**: Feature flags allow disabling without code deployment
- **Zero Risk**: Existing users unaffected until feature explicitly enabled