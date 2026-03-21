# CI/CD Pipeline for Health Sync System

## Overview
This CI/CD setup ensures all changes are tested in an isolated environment before touching production data.

## Environments

### 1. Local Development
- Uses mock/stub APIs
- SQLite database for local state
- No external service calls

### 2. Staging/Test
- Separate Notion database (test clone)
- Separate Nightscout instance (or mock)
- Real API calls, but isolated data

### 3. Production
- Live Notion database
- Live Nightscout
- Only deployed after staging passes

## Workflow

```
Code Change → Local Tests → Staging Deploy → Validation → Production Deploy
```

## Commands

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:unit
npm run test:integration

# Deploy to staging
npm run deploy:staging

# Validate staging
npm run validate:staging

# Deploy to production (only after staging passes)
npm run deploy:production
```

## Test Coverage Requirements
- Unit tests: 80%+ coverage
- Integration tests: All API paths tested
- Data integrity tests: Must pass
- Duplicate prevention tests: Must pass

## Pre-commit Hooks
- Linting
- Unit tests
- Type checking (if using TypeScript)

## GitHub Actions (if using GitHub)
See `.github/workflows/ci.yml`
