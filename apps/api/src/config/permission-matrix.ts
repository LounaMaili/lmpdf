import { loadRuntimeSettings } from './runtime-settings';

export type PermissionAction =
  | 'uploadDocument'
  | 'createTemplate'
  | 'manageTemplate'
  | 'editStructure'
  | 'createPage'
  | 'exportPdf'
  | 'printDocument';

export type RolePermissions = Record<PermissionAction, boolean>;

export const DEFAULT_ROLE_PERMISSIONS: Record<string, RolePermissions> = {
  admin: {
    uploadDocument: true,
    createTemplate: true,
    manageTemplate: true,
    editStructure: true,
    createPage: true,
    exportPdf: true,
    printDocument: true,
  },
  editor: {
    uploadDocument: true,
    createTemplate: true,
    manageTemplate: true,
    editStructure: true,
    createPage: true,
    exportPdf: true,
    printDocument: true,
  },
  viewer: {
    uploadDocument: false,
    createTemplate: false,
    manageTemplate: false,
    editStructure: false,
    createPage: false,
    exportPdf: false,
    printDocument: false,
  },
};

export async function resolveRolePermissions(role?: string): Promise<RolePermissions> {
  const key = (role || 'viewer').toLowerCase();
  const settings = await loadRuntimeSettings();
  const base = DEFAULT_ROLE_PERMISSIONS[key] ?? DEFAULT_ROLE_PERMISSIONS.viewer;
  const override = settings.permissions?.[key as keyof typeof settings.permissions] ?? {};
  return { ...base, ...override };
}

export async function canUser(role: string | undefined, action: PermissionAction): Promise<boolean> {
  const perms = await resolveRolePermissions(role);
  return Boolean(perms[action]);
}
