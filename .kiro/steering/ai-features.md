---
inclusion: manual
---

# AI Features & Integration

## AI Personas System
- **Four personas**: CMO, DS (Data Scientist), VG (VP Growth), MNK (Marketing Analytics)
- **Prompt stuffing**: Instructions automatically added to user queries
- **Configuration**: `data/extra_config.json` with persona definitions
- **Admin management**: Create/edit personas via admin panel
- **User selection**: Dropdown in settings panel, persists across sessions

## Prompt Templates
- **Hierarchical organization**: Agent → Area → Group → Prompt
- **Parameter system**: Text, select, textarea, number input types
- **YAML storage**: `prompts/{agent_name}/` directory structure
- **Template browser**: 3-step drill-down navigation (Area → Group → Prompt)
- **CLI integration**: Batch processing with template execution

## Title Service
- **Dedicated microservice** on port 8002
- **OpenAI integration** for intelligent title generation
- **Async processing** with conversation analysis
- **Fallback system** to user's first query if AI fails
- **Auto-retry logic** with exponential backoff

## Snowflake Integration
- **Cortex agents**: MEDIAMEASUREMENT_AGENT, ISPOT_SNOWFLAKE_USAGE_AGENT, ISPOTTESTAGENT
- **Per-user credentials** stored securely in user profiles
- **Agent configuration**: `data/agents.yaml` with capabilities and metadata
- **MCP protocol**: Streaming responses with real-time updates
- **Connection testing**: Admin panel can verify agent connectivity
