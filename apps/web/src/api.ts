import type { FieldModel, TemplateModel } from './types';
import { getToken } from './auth';

const runtimeDefaultApiUrl = (() => {
  if (typeof window === 'undefined') return 'http://localhost:3000/api';
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  return `${protocol}//${hostname}:3000/api`;
})();

const API_URL = import.meta.env.VITE_API_URL ?? runtimeDefaultApiUrl;
const BASE_URL = API_URL.replace('/api', '');

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function uploadDocument(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_URL}/uploads/document`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) throw new Error('Upload impossible');
  return res.json() as Promise<{ id: string; url: string; originalName: string; mimeType: string }>;
}

export async function getDocumentUrl(docId: string): Promise<{ url: string; mimeType: string } | null> {
  try {
    const res = await fetch(`${API_URL}/uploads/${docId}`, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string; path: string; mimeType: string };
    const resolvedUrl = data.url ? `${BASE_URL}${data.url}` : `${BASE_URL}/uploads/${data.path}`;

    // Files are protected by JWT; fetch with auth and return a blob URL usable by <img>/PDF viewer.
    const fileRes = await fetch(resolvedUrl, { headers: authHeaders() });
    if (!fileRes.ok) return null;
    const blob = await fileRes.blob();
    const blobUrl = URL.createObjectURL(blob);

    return { url: blobUrl, mimeType: data.mimeType || blob.type };
  } catch {
    return null;
  }
}

export async function listTemplates() {
  const res = await fetch(`${API_URL}/templates`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les templates');
  return res.json() as Promise<TemplateModel[]>;
}

export async function saveTemplate(payload: {
  name: string;
  sourceFileId?: string;
  rotation?: 0 | 90 | 180 | 270;
  fields: FieldModel[];
}) {
  const res = await fetch(`${API_URL}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error('Impossible de sauvegarder le template');
  return res.json() as Promise<TemplateModel>;
}

export async function deleteTemplate(id: string) {
  const res = await fetch(`${API_URL}/templates/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de supprimer le template');
}

export type SuggestedField = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  confidence: number;
};

export async function detectFields(documentId: string, options?: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ documentId, options }),
  });
  if (!res.ok) throw new Error('Détection impossible');
  return res.json() as Promise<{ suggestedFields: SuggestedField[]; error?: string }>;
}

// ───── Document Permissions ─────

export type DocPermission = {
  id: string;
  docRole: 'owner' | 'editor' | 'filler';
  userId?: string;
  groupId?: string;
  user?: { id: string; email: string; displayName: string };
  group?: { id: string; name: string };
};

export async function listDocPermissions(docId: string): Promise<DocPermission[]> {
  const res = await fetch(`${API_URL}/documents/${docId}/permissions`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les permissions');
  return res.json();
}

export async function shareDocument(docId: string, payload: { userId?: string; groupId?: string; docRole: string }) {
  const res = await fetch(`${API_URL}/documents/${docId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Impossible de partager le document');
  return res.json();
}

export async function revokeDocPermission(docId: string, payload: { userId?: string; groupId?: string }) {
  const res = await fetch(`${API_URL}/documents/${docId}/permissions`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Impossible de révoquer la permission');
  return res.json();
}

export async function getMyDocRole(docId: string): Promise<{ documentId: string; docRole: string | null }> {
  const res = await fetch(`${API_URL}/documents/${docId}/permissions/me`, { headers: authHeaders() });
  if (!res.ok) return { documentId: docId, docRole: null };
  return res.json();
}

// ───── Users (search) ─────

export async function searchUsers(query: string): Promise<Array<{ id: string; email: string; displayName: string }>> {
  const res = await fetch(`${API_URL}/users/search?q=${encodeURIComponent(query)}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

// ───── Groups ─────

export async function listGroups(): Promise<Array<{ id: string; name: string; _count?: { members: number } }>> {
  const res = await fetch(`${API_URL}/groups`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function createGroup(name: string, personal = true): Promise<{ id: string; name: string }> {
  const res = await fetch(`${API_URL}/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, personal }),
  });
  if (!res.ok) throw new Error('Impossible de créer le groupe');
  return res.json();
}

export async function getGroupDetails(groupId: string): Promise<{ id: string; name: string; members: Array<{ user: { id: string; email: string; displayName: string } }> }> {
  const res = await fetch(`${API_URL}/groups/${groupId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger le groupe');
  return res.json();
}

export async function addGroupMember(groupId: string, userId: string) {
  const res = await fetch(`${API_URL}/groups/${groupId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error('Impossible d\'ajouter le membre');
  return res.json();
}

export async function removeGroupMember(groupId: string, userId: string) {
  const res = await fetch(`${API_URL}/groups/${groupId}/members/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Impossible de retirer le membre');
  return res.json();
}

export async function deleteGroup(groupId: string) {
  const res = await fetch(`${API_URL}/groups/${groupId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Impossible de supprimer le groupe');
  return res.json();
}

// ───── Folders ─────

export type FolderModel = {
  id: string;
  name: string;
  parentId: string | null;
  ownerId: string | null;
  groupId: string | null;
};

export async function listFolders(): Promise<FolderModel[]> {
  const res = await fetch(`${API_URL}/folders`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function createFolder(name: string, parentId?: string): Promise<FolderModel> {
  const res = await fetch(`${API_URL}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name, parentId }),
  });
  if (!res.ok) throw new Error('Impossible de créer le dossier');
  return res.json();
}

export async function renameFolder(id: string, name: string): Promise<FolderModel> {
  const res = await fetch(`${API_URL}/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Impossible de renommer le dossier');
  return res.json();
}

export async function moveDocumentToFolder(folderId: string, documentId: string) {
  const res = await fetch(`${API_URL}/folders/${folderId}/move-document`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ documentId }),
  });
  if (!res.ok) throw new Error('Impossible de déplacer le document');
  return res.json();
}

export async function deleteFolder(id: string) {
  const res = await fetch(`${API_URL}/folders/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Impossible de supprimer le dossier');
  return res.json();
}

export async function moveTemplateToFolder(folderId: string, templateId: string) {
  const res = await fetch(`${API_URL}/folders/${folderId}/move-template`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ templateId }),
  });
  if (!res.ok) throw new Error('Impossible de déplacer le template');
  return res.json();
}

export async function renameTemplate(id: string, name: string) {
  const res = await fetch(`${API_URL}/templates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Impossible de renommer le template');
  return res.json() as Promise<TemplateModel>;
}


export async function getAdminSettings() {
  const res = await fetch(`${API_URL}/admin/settings`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les paramètres admin');
  return res.json();
}

export async function saveAdminSettings(payload: Partial<Record<string, any>>) {
  const res = await fetch(`${API_URL}/admin/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Impossible de sauvegarder les paramètres admin');
  return res.json();
}


export async function getAdminOverview() {
  const res = await fetch(`${API_URL}/admin/settings/overview`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Impossible de charger l'aperçu admin");
  return res.json();
}

export async function testStorageConnection() {
  const res = await fetch(`${API_URL}/admin/settings/test-storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Test stockage impossible');
  return res.json();
}

export async function testLdapConnection(username: string, password: string) {
  const res = await fetch(`${API_URL}/admin/settings/test-ldap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('Test LDAP impossible');
  return res.json();
}


export type RolePermissions = {
  uploadDocument: boolean;
  createTemplate: boolean;
  manageTemplate: boolean;
  editStructure: boolean;
  createPage: boolean;
  exportPdf: boolean;
  printDocument: boolean;
};

// ───── Export Config ─────

export async function getExportConfig() {
  const res = await fetch(`${API_URL}/admin/export/config`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger la config export');
  return res.json();
}

export async function validateExportConfig() {
  const res = await fetch(`${API_URL}/admin/export/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Validation export impossible');
  return res.json();
}

export async function previewExportResolve(context: {
  username: string;
  displayName?: string;
  email?: string;
  templateName?: string;
  templateId?: string;
  authSource?: string;
  role?: string;
  groups?: string[];
}) {
  const res = await fetch(`${API_URL}/admin/export/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(context),
  });
  if (!res.ok) throw new Error('Preview export impossible');
  return res.json();
}

// ───── Export Run (server-side write) ─────

export type ExportResolveResult = {
  matched: boolean;
  enabled?: boolean;
  ruleLabelMatched?: string;
  destinationName?: string;
  resolvedPath?: string;
  resolvedFileName?: string;
  fullPath?: string;
  conflictStrategy?: string;
  errors: string[];
};

export type ExportRunResult = {
  ok: boolean;
  written: boolean;
  finalPath: string;
  skipped: boolean;
  renamed: boolean;
  ruleLabelMatched?: string;
  destinationName?: string;
};

/**
 * Resolve the export destination for the current user.
 * Returns what path would be used, without actually writing anything.
 */
export async function resolveExportDestination(context: {
  templateName?: string;
  templateId?: string;
}): Promise<ExportResolveResult> {
  const res = await fetch(`${API_URL}/export/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(context),
  });
  if (!res.ok) {
    return { matched: false, errors: ['Erreur de résolution export'] };
  }
  return res.json();
}

/**
 * Run a server-side export: send the generated PDF bytes to the backend
 * which writes them to the configured filesystem destination.
 */
export async function runServerExport(
  pdfBlob: Blob,
  context: { templateName?: string; templateId?: string },
): Promise<ExportRunResult> {
  const formData = new FormData();
  formData.append('file', pdfBlob, 'export.pdf');
  if (context.templateName) formData.append('templateName', context.templateName);
  if (context.templateId) formData.append('templateId', context.templateId);

  const res = await fetch(`${API_URL}/export/run`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Export serveur impossible');
  }
  return res.json();
}

// ───── Export Logs (Admin) ─────

export type ExportLogEntry = {
  id: string;
  createdAt: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  templateName: string | null;
  templateId: string | null;
  ruleLabelMatched: string | null;
  destinationName: string | null;
  conflictStrategy: string | null;
  finalPath: string | null;
  status: 'written' | 'skipped' | 'renamed' | 'error';
  errorMessage: string | null;
  fileSizeBytes: number | null;
};

export type ExportLogsResponse = {
  logs: ExportLogEntry[];
  total: number;
  limit: number;
  offset: number;
};

export async function getExportLogs(params?: {
  limit?: number;
  offset?: number;
  status?: string;
  userId?: string;
  userEmail?: string;
  from?: string;
  to?: string;
}): Promise<ExportLogsResponse> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.status) qs.set('status', params.status);
  if (params?.userId) qs.set('userId', params.userId);
  if (params?.userEmail) qs.set('userEmail', params.userEmail);
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  const res = await fetch(`${API_URL}/admin/export/logs?${qs.toString()}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les logs d\'export');
  return res.json();
}

// ───── Export Stats (Admin) ─────

export type ExportStatsResponse = {
  totalExports: number;
  totalWritten: number;
  totalRenamed: number;
  totalSkipped: number;
  totalErrors: number;
  totalFileSizeBytes: number;
  uniqueUsers: number;
  lastExport: ExportLogEntry | null;
  lastError: ExportLogEntry | null;
};

export async function getExportStats(): Promise<ExportStatsResponse> {
  const res = await fetch(`${API_URL}/admin/export/stats`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les stats d\'export');
  return res.json();
}

// ───── Export Logs Purge (Admin) ─────

export type ExportPurgeResponse = {
  purged: number;
  mode: string;
};

export async function purgeExportLogs(params: {
  olderThanDays?: number;
  all?: boolean;
}): Promise<ExportPurgeResponse> {
  const qs = new URLSearchParams();
  qs.set('confirm', 'yes');
  if (params.all) qs.set('all', 'true');
  if (params.olderThanDays) qs.set('olderThanDays', String(params.olderThanDays));
  const res = await fetch(`${API_URL}/admin/export/logs?${qs.toString()}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Impossible de purger les logs d\'export');
  return res.json();
}

export async function getMyPermissions(): Promise<RolePermissions> {
  const res = await fetch(`${API_URL}/auth/permissions`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les permissions');
  return res.json();
}

// ───── MFA ─────

export type MfaStatus = {
  mfaEnabled: boolean;
  backupCodesRemaining: number;
  backupCodesTotal: number;
  policy: 'disabled' | 'optional' | 'required';
};

export type MfaSetupResult = {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
};

export async function getMfaStatus(): Promise<MfaStatus> {
  const res = await fetch(`${API_URL}/auth/mfa/status`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger le statut MFA');
  return res.json();
}

export async function startMfaSetup(): Promise<MfaSetupResult> {
  const res = await fetch(`${API_URL}/auth/mfa/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Erreur setup MFA');
  }
  return res.json();
}

export async function confirmMfaSetup(secret: string, token: string): Promise<{ success: boolean; backupCodes: string[] }> {
  const res = await fetch(`${API_URL}/auth/mfa/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ secret, token }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Code TOTP invalide');
  }
  return res.json();
}

export async function disableMfa(password: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_URL}/auth/mfa/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Erreur désactivation MFA');
  }
  return res.json();
}

export async function regenerateBackupCodes(password: string): Promise<{ success: boolean; backupCodes: string[] }> {
  const res = await fetch(`${API_URL}/auth/mfa/regenerate-backup-codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Erreur régénération backup codes');
  }
  return res.json();
}

// ───── WebAuthn (V2) ─────

export type WebAuthnCredential = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  transports: string[];
};

export async function listWebauthnCredentials(): Promise<WebAuthnCredential[]> {
  const res = await fetch(`${API_URL}/auth/webauthn/credentials`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les clés de sécurité');
  return res.json();
}

export async function beginWebauthnRegistration(password: string): Promise<any> {
  const res = await fetch(`${API_URL}/auth/webauthn/register/begin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Mot de passe invalide ou erreur serveur');
  }
  return res.json();
}

export async function finishWebauthnRegistration(response: any, label?: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_URL}/auth/webauthn/register/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ response, label }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || 'Erreur enregistrement clé');
  }
  return res.json();
}

export async function deleteWebauthnCredential(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_URL}/auth/webauthn/credentials/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Erreur suppression clé');
  return res.json();
}

export async function renameWebauthnCredential(id: string, label: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_URL}/auth/webauthn/credentials/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error('Erreur renommage clé');
  return res.json();
}

// ───── Admin MFA Management (V4) ─────

export type AdminUserMfaStatus = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  authSource: string;
  mfaEnabled: boolean;
  totpConfigured: boolean;
  backupCodes: {
    total: number;
    remaining: number;
    used: number;
  };
  webauthnCredentials: Array<{
    id: string;
    label: string;
    createdAt: string;
    lastUsedAt: string | null;
    transports: string[];
  }>;
  webauthnCount: number;
};

export type AdminUserListEntry = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  authSource: string;
  externalId: string | null;
  isActive: boolean;
  createdAt: string;
  mfaEnabled: boolean;
  backupCodesCount: number;
  webauthnKeysCount: number;
};

export async function getAdminUserMfaStatus(userId: string): Promise<AdminUserMfaStatus> {
  const res = await fetch(`${API_URL}/admin/users/${userId}/mfa`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger le statut MFA');
  return res.json();
}

export async function adminResetTotp(userId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_URL}/admin/users/${userId}/mfa/reset-totp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  if (!res.ok) throw new Error('Impossible de réinitialiser le TOTP');
  return res.json();
}

export async function adminDeleteAllBackupCodes(userId: string): Promise<{ success: boolean; deleted: number; message: string }> {
  const res = await fetch(`${API_URL}/admin/users/${userId}/mfa/backup-codes`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Impossible de supprimer les backup codes');
  return res.json();
}

export async function adminDeleteWebauthnCredential(userId: string, credentialId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_URL}/admin/users/${userId}/mfa/webauthn/${credentialId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Impossible de supprimer la clé WebAuthn');
  return res.json();
}

export async function adminDeleteAllWebauthnCredentials(userId: string): Promise<{ success: boolean; deleted: number; message: string }> {
  const res = await fetch(`${API_URL}/admin/users/${userId}/mfa/webauthn`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Impossible de supprimer les clés WebAuthn');
  return res.json();
}

export async function adminResetAllMfa(userId: string): Promise<{ success: boolean; message: string; details: { backupCodesDeleted: number; webauthnKeysDeleted: number } }> {
  const res = await fetch(`${API_URL}/admin/users/${userId}/mfa/reset-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  });
  if (!res.ok) throw new Error('Impossible de réinitialiser le MFA');
  return res.json();
}

export async function getAdminUsers(): Promise<AdminUserListEntry[]> {
  const res = await fetch(`${API_URL}/users`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les utilisateurs');
  return res.json();
}

// ───── Autosave Drafts ─────

export type DraftPayload = {
  name: string;
  fields: FieldModel[];
  rotation: number;
  pageCount: number;
  preset?: any;
};

export type DraftRecord = {
  id: string;
  userId: string;
  templateId: string | null;
  sourceFileId: string | null;
  payload: DraftPayload;
  updatedAt: string;
  createdAt: string;
};

export async function upsertDraft(key: { templateId?: string; sourceFileId?: string }, payload: DraftPayload): Promise<DraftRecord> {
  const res = await fetch(`${API_URL}/drafts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...key, payload }),
  });
  if (!res.ok) throw new Error('Erreur sauvegarde brouillon');
  return res.json();
}

export async function getDraft(key: { templateId?: string; sourceFileId?: string }): Promise<DraftRecord | null> {
  const params = new URLSearchParams();
  if (key.templateId) params.set('templateId', key.templateId);
  if (key.sourceFileId) params.set('sourceFileId', key.sourceFileId);
  const res = await fetch(`${API_URL}/drafts?${params.toString()}`, { headers: authHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.draft ?? null;
}

export async function clearDraft(key: { templateId?: string; sourceFileId?: string }): Promise<void> {
  const params = new URLSearchParams();
  if (key.templateId) params.set('templateId', key.templateId);
  if (key.sourceFileId) params.set('sourceFileId', key.sourceFileId);
  await fetch(`${API_URL}/drafts?${params.toString()}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}
