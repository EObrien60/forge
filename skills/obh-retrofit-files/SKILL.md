---
name: obh-retrofit-files
description: Use to assess or replace ad-hoc upload/storage code (multer, Vercel Blob, local disk, raw S3 SDK) with @obh/files. Maps each storage choke-point to createFilesClient behind the same function signature (assessment); then installs the primitive and moves uploads to signed direct-to-storage (implementation). Assessment-only by default; implements on request.
---

Purpose: consolidate all file storage behind the **files** primitive so the product never touches bytes or bucket credentials — it stores a `file_id` and asks `@obh/files` for signed URLs. Uploads go direct from client to storage; downloads are signed, time-boxed URLs.

## Assessment (read-only)

1. **Locate storage code.** Grep for: `multer`, `formidable`, `@vercel/blob`, `fs.writeFile`/`createWriteStream` to an uploads dir, `@aws-sdk/client-s3` / `S3Client` / `getSignedUrl`, `putObject`, `Bucket`. Identify every choke-point where bytes enter or leave the app and how the resulting location is persisted (a URL column, a path, a bucket key).

2. **Map the current model to file_id.** Wherever the product stores a URL/path/key, it should store a `file_id` (FK to the platform files table). List the columns and code paths that need to change from "store a URL" to "store an id, resolve to a signed URL on read". Note the function signatures to keep stable and the existing rows that will need a backfill.

Produces the **files retrofit plan**. Nothing above mutates the repo — a valid stopping point when you only need the survey.

## Implementation (only after the plan is agreed)

3. **Install the primitive.** Run `forge add files` (`--dry-run` first). This adds the files migration to `scripts/migrations.d/*` and the `@obh/files` client (`createFilesClient`/`pgAdapter`). Run `pnpm migrate`. Record required secret NAMES (bucket/endpoint/keys) for deploy — values go in via `lwd secret set`, never committed.

4. **Swap behind the same signature.** Keep the existing function (e.g. `saveAvatar(userId, upload)`), but replace its body with `createFilesClient` calls: request a signed upload target, hand it to the client, and record the returned `file_id`. Callers don't change. Do the same for reads: a `getAvatarUrl(fileId)` that returns a signed URL.

5. **Move to direct-to-storage uploads.** For large/user uploads, have the API mint a signed upload URL and return it; the client PUTs bytes straight to storage; the client then confirms the `file_id`. This removes multipart bodies and the app-as-proxy pattern. For server-generated files (reports, exports), upload from the worker and store the `file_id`.

6. **Retire old storage.** Remove multer/blob/disk/S3 wiring and any static file-serving route. Run the backfill: for existing rows, register current objects with `@obh/files` to obtain `file_id`s, then drop the old URL/path columns once nothing reads them. Then `forge doctor`.

## Output

**Assessment →** the files retrofit plan: a table of storage choke-point → replacement `@obh/files` call → the function signature kept stable → the column moving from URL/path to `file_id`, plus a backfill/cutover note for existing rows. **Implementation →** the `forge add files` + `pnpm migrate` steps, required secret NAMES, the direct-to-storage upload flow (mint URL → client PUT → confirm id), and the retired legacy storage code.
