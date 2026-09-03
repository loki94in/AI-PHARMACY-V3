# Database / Backend Schema Safety — Universal Always-On Rule

**MANDATORY for any feature, change, or bugfix that creates, touches, or queries persistent database entities.**

## Read before coding

1. **`BACKEND SCHEMA SAFETY.md`** (repo root) — mandatory schema safety standard, rules, and verification checklist.
2. **Project `AGENTS.md`** — architecture contracts, migration rules, and speed architecture.
3. **`src/database.ts`** — current schema version, migrations, table DDL, and index declarations.

## Core Mandates

- **Code Reference ≠ Database Existence**: Never assume a table, column, index, or constraint exists because TypeScript interfaces, API routes, or backend queries reference it.
- **One Complete Chain**: Treat Feature → Backend Code → Database Schema → Migration → Indexes → Constraints → Seeds → Initialization → Runtime Verification → Tests as ONE atomic unit.
- **Both Boot Paths**: If fast-boot DDL skipping is active, all newly introduced or dependent tables/columns must be guaranteed across BOTH fast-boot and full-schema paths.
- **Fresh & Existing DB Verification**: Must verify that the feature works from an empty fresh database AND after upgrading an existing production-like database without data loss.
- **Zero Schema Errors**: `SQLITE_ERROR: no such table`, `no such column`, or `no such index` are blocking defects. Silent fallbacks (returning `[]` or hiding errors) are strictly forbidden.
- **Mandatory Final Report**: Every database change must conclude with the Section 24 report from `BACKEND SCHEMA SAFETY.md`.

Full specification: **`BACKEND SCHEMA SAFETY.md`**
