# CHANGELOG

## 2026-02-16

### Added
- Backup before new permission/storage batch: `/home/openclaw/save_LMPdf/LMPdf_2026-02-16_221503`
- Document role badge in left panel (`Propriétaire / Éditeur / Remplisseur`) for the active document
- Lock-action feedback: explicit status message when a filler tries to move/resize a locked field
- Logical storage groundwork:
  - New `Folder` model (hierarchical tree via `parentId`)
  - `folderId` relation added on `Document` and `Template`
  - Basic folders API (`/folders`) with create/list/rename and move document/template endpoints
- Hybrid group support hardened with `Group.createdById` (org groups vs personal groups)

### Changed
- Fillers can no longer alter lock settings from the properties panel (lock toggle hidden)

## 2026-02-16

### Added
- **Document permissions system**: `DocRole` enum (owner/editor/filler), `DocumentPermission` table (share by user AND/OR group)
- **Field locking**: `locked` property on `Field` — prevents structure modification by fillers
- **Permissions API**: REST endpoints `/documents/:docId/permissions` (list, share, revoke, my role)
- **User search endpoint**: `GET /users/search?q=...` accessible to all authenticated users
- **Share modal**: 🔗 Share button, user/group search, role assignment, current access list, revocation
- **Lock UI**: 🔒 checkbox in properties panel + padlock icon on locked fields in editor

### Improved
- Compact field list (reduced padding, 11px font, 24px min height)
- Minimalist reorder buttons (lightweight glyphs, transparent background)

## 2026-02-15

### Added
- **Keyboard navigation**: Tab / Shift+Tab cycles through document fields in order (editor area only; side panels unaffected). Clicking the editor background then pressing Tab selects the first field.
- **Field reordering**: Up/Down (▲/▼) buttons in the right-panel field list to reorder fields; order defines Tab navigation sequence. Multi-select behavior preserved.
- **Date field type**: New `date` field type with DD/MM/YYYY auto-formatting mask. Digits auto-format with slashes; cursor position preserved during edits. Available in both individual and bulk type selectors. Renders naturally in PDF export.

### Changed
- Field overlays now carry `data-field-id` attribute for programmatic focus after Tab navigation.
- Interactive field elements (textarea, input, checkbox, counter) use `tabIndex={-1}` to prevent browser Tab from escaping to side panels.
- Editor section made programmatically focusable (`tabIndex={-1}`) so clicking the page background allows Tab to start field cycling.
- Export PDF skips empty date fields (same as empty text fields).
- Documentation and code comments homogenized for better maintainability (consistent naming, clear intent comments in key files).

## 2026-02-14

### Added
- JWT auth hardening: fail-fast in production if `JWT_SECRET` is still default.
- Ownership scoping on documents/templates (owner/admin access rules).
- Persisted template field data model support for `value` and `style`.
- Text fields now support multiline input (textarea) with auto-wrap.

### Changed
- PDF loading path in web viewer adjusted for better compatibility with rotated/re-saved PDFs.
- Export pipeline updated to better handle rotation mapping and multiline text rendering.
- Field overlay content rotation handling adjusted to improve text orientation and positioning behavior.
- Checkbox rendering switched from cross to check mark, with automatic size scaling to field box in editor and exported PDF.
- PDF viewer loading stabilized: waits for fetched buffer before rendering pdf.js document (reduces flaky post-upload display failures).

### Infra/ops
- Backup snapshots created in `/home/openclaw/save_LMPdf/` with timestamped folder names.
- Postgres volume permission incident fixed (`pg_filenode.map` access errors), then services restarted.
- Migration applied: `20260214195000_add_field_value_style`.
- Repository housekeeping: removed generated `dist/` outputs and Python `__pycache__` caches.
- Added `PROJECT_STRUCTURE.md` to document folder/file responsibilities.
- Added `MAINTENANCE_UPDATES.md` with monthly update procedure and dependency snapshot.
