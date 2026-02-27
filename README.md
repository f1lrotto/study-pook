# Study Companion (DAV 2026)

React + Vite + Convex study app for state-exam prep.

## Features

- Curriculum tree imported from `raw/dav-okruhy-2026.pdf`
- Theme notes imported from `raw/okruhy.docx`
  - Preserves text, tables, and embedded images in original flow (no OCR)
- Progress tracking per theme (`status` + confidence `0..5`)
- Weighted spin wheel for topic selection
- Dashboard with course completion and "needs attention"

## Stack

- React 19 + Vite + TypeScript
- Convex (queries, mutations, storage)
- Zustand (local profile key)
- Tailwind v4 (via `@tailwindcss/vite`) + custom CSS variables
- Vitest + Testing Library

## Prerequisites

1. Bun installed
2. Convex project configured (`npx convex dev` or deployed URL)
3. Environment variable:

```bash
VITE_CONVEX_URL=...
# for CLI import script you can also use:
CONVEX_URL=...
```

## Install

```bash
bun install
```

## Run app

```bash
bun run dev
```

## Import data

Raw files must exist at:

- `raw/dav-okruhy-2026.pdf`
- `raw/okruhy.docx`

Then run:

```bash
bun run import:data
```

The script:

1. Parses PDF syllabus
2. Upserts curriculum in Convex
3. Parses DOCX blocks in document order
4. Uploads embedded images to Convex storage
5. Converts note streams to canonical markdown notes (`themeNotes`)
6. Skips overwriting user-edited markdown notes by default

## Migrate legacy notes

To backfill existing `noteBlocks` and `manualNotesHtml` into canonical markdown notes:

```bash
bun run migrate:notes
```

Optional flags:

- `--force` to overwrite already migrated `themeNotes`
- `--batch=<n>` to change batch size (default `50`)
- `--keep-legacy-data-url-images` to keep legacy embedded data URLs in migrated markdown

## Commands

```bash
bun run lint
bun run typecheck
bun run test
bun run format
bun run check
bun run migrate:notes
```
