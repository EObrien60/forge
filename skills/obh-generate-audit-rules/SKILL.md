---
name: obh-generate-audit-rules
description: Use when a project has domain events and needs an immutable audit trail. Generates @obh/audit rule mappings (event -> action/target/actor) covering create/update/delete/state-change events, with redaction and immutability notes.
---

Purpose: turn existing domain **events** (facts) into an **audit** trail. The audit primitive derives an immutable log from events — each rule maps one event to an audit record's action, target, and actor. Audit does not observe the DB directly; it reacts to events, so this skill depends on an event catalogue already existing (see obh-add-events).

## Workflow

1. **Collect the events.** Read the project's event definitions (from `@obh/events` `defineX` files / the catalogue). List every event name, its payload, and what state change it represents. If no events exist yet, stop and run obh-add-events first — there is nothing for audit to observe.

2. **Classify each event.** Bucket into create / update / delete / state-change. Every one of these is auditable. Pure read or ephemeral events (e.g. `session.pinged`) usually are not — note them as excluded with a reason.

3. **Derive action/target/actor per rule.**
   - **action** — a stable verb phrase from the event: `note.created` → `note.create`, `invoice.paid` → `invoice.mark_paid`. Keep actions consistent across resources.
   - **target** — the entity acted on: type + id pulled from the payload (`{ type: 'note', id: payload.noteId }`).
   - **actor** — who did it: user/api-key/system id from the payload. If the payload lacks an actor, flag it — the event may need to carry `actorId`.
   - For **update** events, capture a diff (changed fields, or before/after) as audit metadata so the trail is meaningful.

4. **Plan redaction.** Mark payload fields that must not land in the immutable log: secrets, tokens, full PII, large blobs. Specify per-rule redaction (drop or hash) before the audit record is written — remember records are immutable, so a leak can't be edited out later.

5. **Install and wire.** Run `forge add audit` (`--dry-run` first). This adds the audit migration to `scripts/migrations.d/*` and the `@obh/audit` client. Run `pnpm migrate`. Register the rules against the event bus/subscribers (`apps/api/src/bus.d/*` or the audit worker consumer) so each event produces its audit record. Audit writes are append-only — never expose update/delete on them.

## Output

An **audit rule map**: a table of `event.name` → `action` → target (type+id source) → actor (source) → captured metadata/diff → redacted fields, plus an **excluded events** list with reasons; the `forge add audit` + `pnpm migrate` steps; where rules are registered; and an explicit immutability/redaction note (records are append-only; redact before write).
