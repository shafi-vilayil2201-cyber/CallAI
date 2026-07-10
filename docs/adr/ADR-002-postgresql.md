# ADR-002: Selection of PostgreSQL and Prisma ORM

## Status
Accepted

## Context
CallAI requires transactional integrity for subscriptions, invoices, settings, billing, and call cost records. The data is highly relational: organizations have users, assistants, call sessions, billing profiles, and audit trails. Additionally, the system must support low-latency reads for assistant configurations and tenant settings, and perform fast query sorting on call history.

## Decision
We select **PostgreSQL** as the core relational database, combined with **Prisma ORM** as the database client.

## Consequences
- **Relational Integrity**: Foreign key constraints and multi-row ACID transactions guarantee billing and subscription consistency.
- **Tenant Isolation**: Multi-tenant schemas are enforced via indexes on `organizationId` across all models.
- **Type Safety**: Prisma generates TypeScript models directly from the database schema, minimizing manual mapping bugs and query construction errors.
- **Scalability**: PostgreSQL easily scales horizontally through read replicas (which we can route to for analytics/dashboard reads) and vertically for transactional writes.
