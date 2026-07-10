# ADR-004: Selection of Exotel as Primary Telephony Carrier

## Status
Accepted

## Context
CallAI requires an India-first telephony integration that supports high-concurrency PSTN calls, SIP trunking, reliable connection webhooks, and call streaming bridging. The system must also remain extensible to allow integrating international carriers (like Twilio or Plivo) without rewriting core conversation mechanics.

## Decision
We select **Exotel** as our primary telephony provider. To prevent vendor lock-in, we define a standard `TelephonyProvider` interface that wraps all telephony actions.

## Consequences
- **India-First Compliance & Latency**: Low network routing latency for Indian phone numbers and local regulations compliance.
- **Provider Abstraction**: Since Exotel API actions are encapsulated behind the `TelephonyProvider` interface, we can swap in Twilio or Plivo for global customers by adding a new adapter and swapping the configurations.
