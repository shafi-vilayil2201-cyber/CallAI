# ADR-001: Selection of NestJS as the Backend Framework

## Status
Accepted

## Context
CallAI requires a highly structured, scalable, and modular backend codebase to serve as an enterprise-grade voice intelligence platform. We need a framework that natively supports TypeScript, dependency injection, Clean Architecture guidelines, and modules that can eventually be broken apart into microservices as traffic scales to hundreds of thousands of concurrent calls.

## Decision
We select **NestJS** as the primary backend framework. 

## Consequences
- **Modular Monolith**: NestJS facilitates modular monolith design out of the box through `Modules`. Modules keep domain boundaries clean, ensuring that the transition to independent microservices is a matter of config adjustment rather than structural code refactoring.
- **Dependency Injection**: Promotes testability by enabling standard interface mocks during testing.
- **Developer Ecosystem**: Strong TypeScript native configuration, decorator-based decorators for validation (`class-validator`), exception handling, interceptors, and Swagger integrations.
