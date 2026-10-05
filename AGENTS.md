# Working Agreement

This file applies to the whole repository. It records the working standards for contributors and coding agents.

## How we work

- Work like friendly, candid teammates. Be direct, explain trade-offs, and raise concerns early.
- Build one feature at a time as a complete end-to-end capability: agree on the outcome, define acceptance criteria, implement, verify, then document.
- Prefer a small reliable solution over broad unfinished scope.
- Hold every implemented capability to a production-quality bar within the agreed product boundary: correct, secure, observable, accessible, evaluated, and easy to explain.
- Keep code and docs simple and clean. Production quality does not mean speculative infrastructure or unnecessary abstractions.
- Never silently decide a material product, UX, architecture, data, technology, or scope question. Bring it to the project owner with a recommendation, reasoning, and trade-offs before acting.
- Mechanical, reversible implementation choices are allowed only inside an agreed direction; surface any choice that could reasonably affect later work.
- Treat examples and exploratory comments as context, not approved requirements. Confirm before promoting them into product scope, architecture, or evaluation criteria.
- Treat accepted scope and recorded decisions as binding. Do not reopen or expand them during implementation; surface a genuine conflict before changing direction.
- Derive recommendations from the problem and evidence. Do not mirror a technology or idea merely because the project owner mentioned prior experience with it.
- Lead updates with outcomes. Avoid bloated status reports or documentation.
- Match communication to an experienced technical collaborator. Do not repeat established context, re-explain basics, or pad responses; recap only when materially useful or requested.
- Keep implementation with the primary agent so the project owner can follow the work file by file. Do not delegate unless the project owner explicitly asks for parallel agent work.
- Do not select a service that requires paid credentials without explicit approval.
- Never expose secrets or commit credentials.

## Project scope

- Build the EVE Healthcare diagnostic-booking assignment as a backend project aligned with the supplied PDF and its evaluation rubric.
- Use JavaScript with Node.js and Express.js for the backend and PostgreSQL for persistence. Do not introduce TypeScript, a frontend, or substitute frameworks unless the project owner explicitly changes the scope.
- Keep application code in the top-level `backend/` directory.
- Create folders and abstractions only when the current feature needs them. Do not scaffold the complete anticipated architecture up front.
- Add a dependency or configuration file only when the current implementation step requires it. Explain its concrete purpose in plain language before adding it.
- Implement authentication, diagnostic centres and tests, bookings, simulated payments, an idempotent payment webhook, request validation, authorization, and the edge cases named in the assignment.
- Include Docker and Docker Compose, structured logging, and bounded retry handling for webhook processing.
- Treat automated tests as part of the quality baseline. OpenAPI documentation is future work unless the project owner explicitly adds it to the submission scope.
- Before proposing work, identify it as PDF-required, an explicitly chosen bonus, or additional scope. Flag additional scope before implementing it.

## Accepted design decisions

- Public API prices and amounts are numeric INR values. PostgreSQL stores their integer paise equivalents so booking and payment records remain exact.
- Public signup always creates a `USER`; administrative access is granted outside the public API, and management endpoints require an `ADMIN` JWT.
- Booking creation derives the user from the JWT and the amount from the selected centre-test offering. Clients cannot choose the booking owner, amount, or initial status.
- Booking list and detail reads are scoped to the JWT user. Lists are ordered newest first, and unknown or other-user booking IDs return the same `404` response so patient records are not disclosed.
- Booking create, list, and detail endpoints return the same expanded booking representation, including centre and test details and both timestamps.
- New bookings start as `PENDING`. Simulated payment `SUCCESS` maps the booking to `CONFIRMED`, and payment `FAILED` maps it to `FAILED`. `CANCELLED` is a booking state, not a payment result.
- Simulated provider webhooks are identified by a unique event ID and do not use user JWT authentication. Repeated identical events are successful no-ops; reusing an event ID for different payment data is a conflict.
- Webhook processing uses a PostgreSQL-backed retry queue. Unexpected failures are attempted at most three times, with retries after 5 seconds and 30 seconds; validation and business-state conflicts are terminal.
- Application logs are newline-delimited JSON written without a logging dependency. HTTP requests use validated or generated correlation IDs, and sensitive headers, bodies, query strings, tokens, and credentials are never logged.
- Docker Compose keeps PostgreSQL internal to the Compose network, persists it in a named volume, runs migrations as a one-shot service before API startup, and uses development-only credentials that must be replaced outside local use.
- Database seeding is idempotent reference data only: centres, tests, and centre-specific prices. It must not create users, credentials, bookings, payments, or webhook history, and reruns must not overwrite administrative changes.

## Change and review workflow

- Before writing code or changing project configuration, explain the immediate intention and any decision or trade-off involved.
- Ask the project owner instead of assuming when a choice is unclear or could materially affect product behavior, architecture, data modeling, security, or reviewability.
- Work in small, reviewable increments. After each increment, provide the exact file-review sequence and pause when the project owner wants to inspect it.
- Do not create commits or push changes unless the project owner explicitly approves that specific commit or push.
- After a completed, verified increment is ready for source control, proactively recommend a commit and push checkpoint, summarize exactly what would be included, and ask for explicit approval. Do not wait for the project owner to remember this workflow step.
- When the project owner gives a durable workflow or behavior instruction, update this file as part of the current work without waiting to be reminded.
- Maintain `README.md` throughout development. In the same increment, document any change to setup, commands, endpoints, schema, assumptions, architecture, or operational behavior.
- Keep README claims synchronized with the code: describe completed behavior as implemented and label future work clearly. Record approved decisions and their reasoning, not unresolved exploration.
- Structure the README as evaluator-facing technical documentation, not a progress report or requirement checklist. It should explain the system's purpose, architecture, technology choices, setup, API contract, data model, reliability behavior, testing, decisions, assumptions, and production improvements in a coherent order.
- Treat requested documentation restructuring as a presentation constraint, not permission to reduce technical coverage. Preserve valuable, accurate content and compare substantial rewrites against the previous version so quality and completeness only improve unless removal is explicitly requested.
- Ensure the final README covers every submission requirement from the assignment: local run instructions, API endpoints with example requests, database/schema design, important assumptions, and improvements that would be made with more time.
- Keep the README's "improvements with more time" section grounded in concrete extensions to the current assignment. Do not turn it into a generic production-platform wishlist or mention speculative infrastructure such as CI, OpenAPI, tracing, or alerting unless specifically justified and approved.
- Do not claim automated concurrency coverage unless the committed suite actually exercises it. Avoid concurrency-focused wording in the README unless it is necessary, precise, and directly supported by repository evidence.

## Quality bar

- Write production-quality, modular code with clear boundaries, cohesive modules, explicit validation, predictable errors, and tests around meaningful behavior.
- Keep fast request/service tests isolated, and run the disposable PostgreSQL integration suite for changes affecting SQL, migrations, constraints, transactions, locking, or database-backed authorization.
- Avoid generated-looking filler: no speculative abstractions, unnecessary wrappers, vague names, excessive comments, placeholder marketing copy, or UI assembled from repetitive generic cards.
- Prefer the smallest architecture that cleanly satisfies the assignment and can be explained and modified during a live interview.
- Write every application and submission artifact for an evaluator: use concise, professional, submission-ready language in documentation, code comments, errors, examples, API descriptions, and commit messages. Never refer to the project owner, an agent, a conversation, or internal working instructions in those artifacts.
- Use comments only to explain non-obvious intent, constraints, or trade-offs. Do not narrate straightforward code or leave placeholder commentary.

## Repository instructions

- Keep `AGENTS.md` synchronized with durable project decisions and contributor workflow.
