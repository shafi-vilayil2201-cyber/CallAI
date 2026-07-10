# ADR-006: Selection of BullMQ for Asynchronous Task Queuing

## Status
Accepted

## Context
CallAI generates heavy post-call payloads: raw call audio files require AWS S3 uploading, conversation transcripts require formatting and ingestion into PostgreSQL, billing tables require margin calculations, and organization webhooks require delivery. Blocking the main HTTP thread or the WebSocket streaming server with these asynchronous tasks would degrade system performance and stream quality.

## Decision
We select **BullMQ** as our task queue manager, backed by Redis.

## Consequences
- **Asynchronous Execution**: Voice gateways delegate recording uploads and database logging to BullMQ queues, preserving resources for raw audio throughput.
- **Fault Tolerance**: Failed uploads, webhook targets, or database connections are safely retried using exponential backoff settings in BullMQ.
- **Horizontal Scaling**: Worker processes can be scaled independently from API/Gateway servers, matching resource usage with heavy post-call background loads.
