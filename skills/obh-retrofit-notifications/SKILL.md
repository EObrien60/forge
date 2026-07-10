---
name: obh-retrofit-notifications
description: Use to assess or replace ad-hoc transactional email with @obh/notifications. Finds nodemailer/sendgrid/resend/ses sends, inline sendMail in request handlers, and hardcoded email templates, then maps event-triggered mail to template+rule definitions and non-event mail to the direct-send client. Assessment-only by default; implements on request.
---

Purpose: move email out of request handlers behind the **notifications** primitive. The preferred path is event-driven: a **rule** turns a domain event into an intent the worker renders from a **template** and sends over SMTP (retried, dead-lettered). A direct-send client is the escape hatch for mail that isn't a domain event (invites, password resets). The event-driven path requires an event catalogue (see obh-add-events).

## Assessment (read-only)

1. **Find the email code.** Grep for: `nodemailer` / `@sendgrid/mail` / `sendgrid` / `resend` / `postmark` / `@aws-sdk/client-ses` / `ses`; inline `transporter.sendMail` / `.send(...)` in route handlers; hardcoded subject/body/HTML strings; and "send email on X" logic scattered across routes.

2. **Inventory each send site.** For each: what triggers it, the recipient (fixed address? derived from the record? the acting user?), the subject/body and its variables, and whether it fires on a domain state change or on a request action. Flag inline sends that block the request and un-retried failures as the risks this move fixes.

3. **Classify event-driven vs direct-send.** A send that follows a state change (`note.created` → notify) is a **rule**; a send that's part of a request flow with no natural domain event (invite, password reset, verification) is a **direct-send**. Record which each is.

4. **Map each site to the target grammar.**
   - **Event-driven:** a `defineTemplate({ key, channel: "email", subject, bodyText })` (with `{{vars}}`) plus a `defineNotificationRule({ id, eventName, templateKey, recipientStrategy, recipientConfig, variableMapping })` mapping payload fields (`$.payload.title`) into the template. If the triggering event doesn't exist, note obh-add-events must run first.
   - **Direct-send:** a `createNotificationClient({ db })` call at the request site.

Produces the **notifications retrofit plan**. Nothing above mutates the repo — a valid stopping point when you only need the survey.

## Implementation (only after the plan is agreed)

5. **Install.** `forge add notifications` (`--dry-run` first; auto-adds `events`). Adds the migration, the direct-send client at `apps/api/src/platform/notifications.ts`, and the worker side (`notification-defs.ts` for templates+rules, `dispatch.d/notifications.ts` with `events: ["*"]`, `consumers.d/notifications.ts` seeding via `syncTemplates`/`syncRules` then rendering + sending each tick). Run `pnpm migrate`. Record `SMTP_URL` (and `SMTP_FROM`) as required secret NAMEs.

6. **Author templates and rules.** Replace the example `defineTemplate`/`defineNotificationRule` with the ones from the plan; extract each hardcoded subject/body into a template with `{{vars}}` and a `variableMapping` from the event payload. Confirm the triggering events are emitted (obh-add-events).

7. **Cut over and retire.** Replace each event-driven send with an emitted event (delete the inline `sendMail`; the rule now sends it). Replace each transactional send with a `notifications` client call. Then remove the nodemailer/provider wiring and the hardcoded templates.

8. **Validate.** `forge doctor`.

## Output

**Assessment →** the notifications retrofit plan: a table of send site → event-driven|direct → template (subject/body/vars) → rule (event + recipient strategy + `variableMapping`) or client call, the events that must exist first, and the risks (blocking sends, unretried failures) resolved. **Implementation →** the installed client + worker defs, `SMTP_URL`/`SMTP_FROM` secret NAMEs, the authored templates/rules, and the retired provider wiring.
