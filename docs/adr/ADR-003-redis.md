# ADR-003: Selection of Redis as Session Cache and Rate Limiter

## Status
Accepted

## Context
CallAI must remain horizontally scalable. This requires the WebSocket gateways and API servers to be completely stateless. Active phone call metadata (such as stream connection IDs, token buffers, VAD states, and active call rates) must be read and written in sub-millisecond intervals.

## Decision
We select **Redis** as our distributed, in-memory cache and session state repository.

## Consequences
- **Stateless Gateways**: Gateway servers can coordinate audio streaming states and session tracking without keeping local state in RAM, allowing servers to be shut down, restarted, or scaled without call dropped events.
- **High-Throughput / Low Latency**: Redis delivers read/write operations in <1ms, which is critical during active real-time call audio routing.
- **Queue Coordination**: Redis is used as the backing store for BullMQ, coordinating job lock management, retries, and worker distributions.
