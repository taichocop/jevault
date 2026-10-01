# Privacy

Jevault suggests existing Vault folders for the active Markdown note and supports explicitly confirmed manual moves. v0.3 Tag Suggest also provides read-only suggestions from existing Vault tags. This document describes the data handling implemented by the plugin.

## Data sent to TypeSafe

TypeSafe is a third-party service separate from Jevault. When you explicitly run **Jevault: Classify current note**, **Jevault: Suggest tags for current note**, or select **Retry**, Jevault may send the following data to the TypeSafe API:

- The active note title
- The Vault-relative note path
- The full Markdown note body
- Candidate folder paths for folder classification
- Existing Vault Tag candidate names and optional Tag candidate descriptions, when present, for Tag Suggest

These fields are used to request ranked folder suggestions or evaluate existing Tag candidates. Explicit Retry can initiate a new TypeSafe request; Tag Suggest and Retry may consume TypeSafe-managed credits. For information about how TypeSafe handles data, see the [TypeSafe privacy policy](https://typesafe.ai/legal/privacy-policy). That policy describes TypeSafe's practices, not guarantees made by Jevault.

## Local processing

For an explicit classification or Tag Suggest request, Jevault performs the following operations locally:

- Accesses the active note through the Obsidian API
- Enumerates existing Vault folder paths through the Obsidian API
- Builds and filters destination candidates
- Discovers existing Vault Tag candidates through Obsidian metadata APIs
- Loads Jevault settings
- Looks up the selected API key through Obsidian SecretStorage

Plugin load, Settings display, and Suggestion UI display do not send note data. Jevault does not classify, retry, or upload notes in the background.

Manual candidate selection, confirmation, and move use only local Vault operations. They do not send another TypeSafe request or resend note data. The suggestion application retains the original Vault-relative path and an in-memory file identity for safe validation; the UI receives no note body, API key, or raw provider response. Nothing is persisted for move history. Obsidian may update links locally according to the user’s preferences.

The already-on-note annotation uses a local metadata-only snapshot of the exact evaluated note, validated by its original file identity and path. It does not read the note body again or switch to the current active note. Missing metadata or mismatched identity is shown as unknown. This annotation processing is local; candidate Tag names and optional descriptions themselves may be sent to TypeSafe as described above. Tag Suggest results are read-only and have no apply action.

During an explicit **Tag Suggest** or **Retry** operation, Jevault computes local SHA-256 content fingerprints for the exact target note. It compares the evaluated content provenance with that note's public metadata event data to verify metadata freshness and prepare a future Tag Apply authorization. Tracking starts before evaluation and lasts until cancellation, failure, or the result Modal closes; plugin unload also disposes it. Retry starts a new session. Unrelated notes are never fingerprinted by this tracking, and plugin load, Settings display, and note opening do not start it.

Fingerprints and provenance remain only in local memory. They are not sent to TypeSafe, persisted, logged, shown in the UI, or sent to telemetry. Preparing authorization does not trigger another TypeSafe request or modify notes. Without a matching observed metadata event, authorization remains unavailable and read-only suggestions still display; an already indexed unchanged note may remain ineligible until such an event is observed.

## No Jevault backend

Jevault does not operate its own backend. Classification and Tag Suggest requests go from the plugin to the TypeSafe API.

## Telemetry

Jevault does not implement analytics, tracking, usage telemetry, or crash reporting.

## API key

The TypeSafe API key is managed through Obsidian SecretStorage. Jevault's plugin settings retain the selected secret reference/name, not a copy of the API key value. The key is resolved only when needed for an explicit classification or Tag Suggest request and is not logged by Jevault.
