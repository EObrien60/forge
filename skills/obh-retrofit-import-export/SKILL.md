---
name: obh-retrofit-import-export
description: Use to assess or replace ad-hoc CSV import/export code with @obh/import-export. Finds csv-parse/papaparse/fast-csv usage, multipart CSV upload-then-insert handlers, and synchronous export routes, then maps each to a typed import/export registry that runs as background jobs and reads/writes CSV through the files service. Assessment-only by default; implements on request.
---

Purpose: replace hand-rolled CSV handling with the **import-export** primitive. Imports and exports become typed definitions in a registry, run as background **jobs**, and read/write their CSV through the **files** service — so the request path only starts a batch and returns 202, and heavy row work happens in the worker. Requires `files` and `jobs` (auto-added).

## Assessment (read-only)

1. **Find the CSV code.** Grep for: `csv-parse` / `csv-stringify` / `papaparse` / `fast-csv` / `json2csv`; multipart CSV uploads (`multer` + a loop of inserts); export routes that build a CSV string and stream it in the response; "download CSV"/"export" endpoints; and one-off bulk-import scripts.

2. **Inventory each import and export.** For each: the entity type, the columns/fields involved, where imported rows are written (the domain insert), where exported rows are read from, validation done today, and whether it currently blocks the request. Flag synchronous in-request processing and non-idempotent inserts as the risks this move fixes.

3. **Map imports to `defineImport`.** For each importable type, list `fields: [{ key, label, required, schema: z.… }]` and the `commitRow` write — which **must be idempotent** (upsert / natural key), because job retries can re-run it. Note the domain table each `commitRow` targets.

4. **Map exports to `defineExport`.** For each exportable type, list `columns: [{ key, label }]` and the `loadRows` query that supplies them.

5. **Note the job + file flow.** API `imports.createBatch({ workspaceId, importType, sourceFileId })` / `exports.createExport({ workspaceId, exportType })` then enqueue `import_parse_csv` / `export_generate_csv`; the worker drains them, reading/writing CSV via files (signed upload/download URLs). If `events`/`files`/`jobs` aren't present, record the prerequisite.

Produces the **import-export retrofit plan**. Nothing above mutates the repo — a valid stopping point when you only need the survey.

## Implementation (only after the plan is agreed)

6. **Install.** `forge add import-export` (`--dry-run` first; auto-adds `files` + `jobs`). Adds the migration, the registry+client at `apps/api/src/platform/import-export.ts` (a `FileStore` over `@obh/files` + `createImportExportClient({ db, files, registry })`), the start-import/export routes, and the worker tick (`createImportWorker`/`createExportWorker` bound to the `import_*`/`export_*` jobs). Run `pnpm migrate`. Record the files `S3_*` secret NAMES.

7. **Fill in the definitions.** Replace the example `defineImport`/`defineExport` with the types from the plan: real `fields` (with Zod schemas), an idempotent `commitRow`, real `columns`, and a `loadRows` query. Keep the worker's copy in sync (the worker never imports from `apps/api`).

8. **Cut over and retire.** Move upload to files (client uploads the CSV, passes `sourceFileId`); switch export links to the async endpoint (202 → poll/download the generated file). Then delete the old `csv-*` parsing/generation, the in-request loops, and the multer wiring.

9. **Validate.** `forge doctor`.

## Output

**Assessment →** the import-export retrofit plan: per type, the `defineImport` fields + idempotent `commitRow` target and/or `defineExport` columns + `loadRows` source; the job names (`import_parse_csv`/`export_generate_csv`) and file flow; and the `files`/`jobs`/`events` prerequisites. **Implementation →** the installed registry/routes/worker with real definitions, the `S3_*` secret NAMES, the async upload/download flow, and the retired CSV code.
