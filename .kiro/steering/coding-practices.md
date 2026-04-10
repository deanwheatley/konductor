# Coding Practices & Standards

## Core Principles
- **Simplicity over complexity** - Choose simplest correct solution
- **Code reuse over duplication** - Share implementations, avoid copy-paste
- **Security by design** - Build security into every component
- **Memory efficiency** - Prevent leaks, optimize resource usage

## Essential Patterns

### Resource Management
```python
# Always use context managers
async with aiofiles.open(file_path, 'r') as f:
    content = await f.read()

# Close connections explicitly
try:
    response = await session.get(url)
    return response.json()
finally:
    await session.close()
```

### Error Handling
```python
async def process_request(data: dict) -> dict:
    try:
        result = await business_logic(data)
        return {"success": True, "data": result}
    except ValidationError as e:
        logger.warning(f"Validation failed: {e}")
        return {"success": False, "error": "Invalid input"}
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return {"success": False, "error": "Internal error"}
```

### Property-Based Testing Patterns
```python
# WRONG: Assuming buffer state during service failures
assert buffer_size == total_expected_events  # Fails when circuit breaker opens

# RIGHT: Account for failure conditions in property tests
if circuit_breaker_stats["state"] == "closed":
    assert buffer_size == total_expected_events
else:
    # Circuit breaker may have dropped events - test resilience instead
    assert buffer_size >= 0 and buffer_size <= total_expected_events
```