---
inclusion: manual
---

# Intervention Pattern Tracking & Learning

## Purpose
This document tracks patterns where developer intervention was required during implementation and testing phases, enabling continuous improvement and reduced manual involvement over time.

## Intervention Categories

### 1. Logic & Implementation Errors
**Common Patterns:**
- Off-by-one errors in loops and array indexing
- Incorrect boolean logic in conditional statements
- Missing null/undefined checks before object access
- Async/await misuse causing race conditions or deadlocks

**Prevention Strategies:**
- Use comprehensive unit tests with boundary value testing
- Implement defensive programming with explicit null checks
- Follow async/await patterns consistently throughout codebase
- Use type hints and static analysis tools

### 2. Edge Case Handling
**Common Patterns:**
- Empty collections not handled properly
- Extreme values (very large/small numbers, long strings)
- Network timeouts and connection failures
- File system permissions and disk space issues

**Prevention Strategies:**
- Property-based testing with diverse input generators
- Explicit edge case documentation in function docstrings
- Graceful degradation patterns for external dependencies
- Resource availability checks before operations

### 3. Integration & Interface Issues
**Common Patterns:**
- API contract mismatches between services
- Database schema changes breaking existing queries
- Configuration format changes without migration
- Third-party service API changes

**Prevention Strategies:**
- Contract testing between service boundaries
- Database migration scripts with rollback capability
- Configuration validation with schema enforcement
- Version pinning and compatibility testing for dependencies

### 4. Testing Gaps
**Common Patterns:**
- Mocks that don't reflect real service behavior
- Test data that doesn't represent production scenarios
- Missing integration tests for critical user flows
- Property tests with insufficient value range coverage

**Prevention Strategies:**
- Regular mock validation against real services
- Production data sampling for test case generation
- User journey mapping to identify critical test paths
- Property test generator review and expansion

### 5. Test Output Management Issues
**Common Patterns:**
- Test output too large to load into context for analysis
- Tests hanging while waiting for user input when output is piped to files
- Complex test results requiring chunked reading for processing
- Interactive test prompts becoming invisible during automated execution

**Prevention Strategies:**
- Always use non-interactive test execution flags (e.g., `pytest --tb=short --no-header`)
- Implement test output file management with chunked reading patterns
- Use timeout mechanisms for test execution to prevent hanging
- Structure test commands to avoid interactive prompts in CI/automated contexts