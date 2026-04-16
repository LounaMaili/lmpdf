# Architecture

## Overview

LMPdf is a web application for filling PDF forms. A scanned or born-digital PDF is uploaded, field zones are detected or defined manually, and users fill the form fields online. The filled PDF is then exported.

**Approach:** scanned/born-digital PDF as background + positioned field overlays on top. Guarantees visual fidelity without requiring a full CSS conversion of the document.

## Stack

| Layer | Technology | Location |
|---|---|---|
| Frontend | React + Vite + TypeScript | `apps/web/` |
| Backend API | NestJS + Prisma + PostgreSQL | `apps/api/` |
| Vision service | Python (FastAPI / PIL) | `apps/vision/` |
| Object storage | Garage (S3-compatible) | `infra/` |
| Job queue | Redis | `infra/` |
| Runtime | Docker Compose | `infra/` |

## Frontend (`apps/web/`)

Single-page React application. Renders the PDF on an HTML5 `<canvas>` using `pdf.js`. Fields are React components absolutely-positioned over the canvas.

**Key components:**
- `App.tsx` — root component, state management, keyboard shortcuts
- `PdfViewer.tsx` — canvas rendering, page navigation, zoom
- `FieldOverlay.tsx` — renders a single field (text, checkbox, counter, date)
- `RichTextEditor.tsx` — `contentEditable` wrapper for inline text formatting
- `SelectionToolbar.tsx` — floating B/I/U/S + color toolbar for text selections
- `PropertiesPanel.tsx` — right sidebar: field properties, font, colors, alignment
- `AutosaveIndicator.tsx` — "Brouillon enregistré" status display

**State:** React `useState` + `useReducer`-style patterns in `App.tsx`. No external state library.

## Backend API (`apps/api/`)

NestJS REST API. All endpoints are under `/api/`.

**Modules:**
- `auth/` — login, register, JWT, MFA (TOTP + WebAuthn), LDAP
- `templates/` — CRUD for PDF form templates (name, fields, PDF file reference)
- `upload/` — handles PDF upload, stores file in Garage S3
- `documents/` — per-user filled document instances, autosave
- `drafts/` — draft state persistence between autosave cycles
- `permissions/` — sharing (owner/editor/filler roles per document)
- `detect/` — triggers the vision service for automatic field detection
- `export/` — merges field values back into PDF and returns the filled file
- `folders/` — folder hierarchy for organizing templates
- `groups/` — user groups for sharing
- `users/` — user management
- `admin-settings/` — instance-wide settings

**Auth:** JWT bearer tokens. Role matrix (`config/permission-matrix.ts`) defines what each role (`owner`, `editor`, `filler`) can do.

**Storage:** Prisma ORM → PostgreSQL for metadata. Garage S3 for binary files (PDFs, exported outputs).

## Vision Service (`apps/vision/`)

Python service. Receives a PDF page image and returns detected field rectangles (zone coordinates).

**Detector:** PIL-based image analysis → candidate zones. Not full OCR — detects likely field areas based on visual contrast and layout.

**Communication:** Backend calls the vision service directly (HTTP).

## Infrastructure (`infra/`)

```
infra/
├── docker-compose.yml        ← all services
├── postgres-data/            ← PostgreSQL data (volume)
├── redis-data/              ← Redis data (volume)
├── garage-data/             ← Garage S3 data (volume)
└── Caddyfile                ← reverse proxy (optional)
```

**Containers:**
- `lmpdf-api` — NestJS backend
- `lmpdf-web` — static file server for the React build
- `lmpdf-vision` — Python vision service
- `lmpdf-postgres` — PostgreSQL
- `lmpdf-redis` — Redis (autosave locking)
- `lmpdf-garage` — Garage S3-compatible object store

## Data Flow

```
User uploads PDF
       ↓
  apps/api (upload/)
       ↓
  Garage S3 (raw PDF)
       ↓
  Template created
       ↓
  Vision service (optional detection)
       ↓
  Fields stored in PostgreSQL (per template)
       ↓
  User fills fields in apps/web
       ↓
  Autosave → apps/api (drafts/) → PostgreSQL
       ↓
  Export → apps/api (export/) → merge values into PDF → Garage S3 → download
```

## Security Model

Roles per document:
- **owner** — full access, can delete/sharing
- **editor** — can fill and modify structure
- **filler** — can only fill field values, cannot move/resize/lock fields

Global permission matrix (`apps/api/src/config/permission-matrix.ts`) gates every API endpoint.
