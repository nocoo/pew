# Autoresearch: L2 API E2E Coverage Improvement

## Objective
Improve L2 Integration/API E2E test coverage to ≥90% endpoint coverage.

## Constraints
- Must NOT affect production environment
- Must use D1 test isolation (pew-db-test)
- Must make real HTTP calls (not mock imports)
- Atomic commits, no push until complete

## Primary Metric
- **l2_coverage_pct**: Percentage of API endpoints covered by L2 E2E tests (higher is better)

## Baseline
| Metric | Value |
|--------|-------|
| Total API routes | 65 |
| Routes with L2 E2E tests | 8 |
| **L2 Coverage** | **12.3%** |

## Target
- L2 Coverage ≥ 90% (≥59 routes covered)

## Uncovered Routes by Priority

### High Priority (Core User Features)
- `/api/projects` - CRUD for projects
- `/api/settings` - User settings
- `/api/devices` - Device management
- `/api/leaderboard` - Public leaderboard
- `/api/sessions` - Session data
- `/api/users/[slug]` - User profiles
- `/api/users/[slug]/achievements` - User achievements

### Medium Priority (Teams/Orgs)
- `/api/teams/*` (5 routes)
- `/api/organizations/*` (6 routes)
- `/api/seasons/*` (4 routes)

### Lower Priority (Admin)
- `/api/admin/*` (18 routes) - Requires admin auth

### Auth Routes
- `/api/auth/code` - Code-based login
- `/api/auth/code/verify` - Verify code
- `/api/auth/verify-invite` - Invite verification
- `/api/auth/invite-required` - Invite gate check

## Strategy
1. Start with highest-value user-facing routes
2. Group related routes together (e.g., all team routes)
3. Leverage existing test user setup from run-e2e.ts
4. Skip NextAuth catch-all (framework-level)

## Rules
- Every test must use real HTTP (fetch to localhost:17020)
- Every test must use isolated test database (pew-db-test)
- Verify D1 isolation before each test run
- Atomic commits per route group
