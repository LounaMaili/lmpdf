export type DocumentRole = 'owner' | 'editor' | 'filler' | null;

/** A missing role on an existing document must fail closed while it is loading. */
export function canEditDocumentStructure(role: DocumentRole, hasDocument: boolean): boolean {
  return !hasDocument || role === 'owner' || role === 'editor';
}

/** Filling may update values, never a mixed value+structure patch. */
export function canApplyFieldPatch(canEditStructure: boolean, patch: object): boolean {
  return canEditStructure || Object.keys(patch).every((key) => key === 'value');
}

export function canApplyDetection(
  active: { sourceFileId?: string; canEditStructure: boolean },
  requestedDocumentId: string,
): boolean {
  return active.canEditStructure && active.sourceFileId === requestedDocumentId;
}

export function editorPermissions(
  global: { editStructure: boolean; createTemplate: boolean; manageTemplate: boolean; exportPdf: boolean; printDocument: boolean },
  role: DocumentRole,
  hasDocument: boolean,
) {
  const structureAllowed = canEditDocumentStructure(role, hasDocument);
  return {
    canEditStructure: global.editStructure && structureAllowed,
    canSaveTemplate: global.createTemplate && structureAllowed,
    canManageTemplate: global.manageTemplate && structureAllowed,
    canExport: global.exportPdf && hasDocument && structureAllowed,
    canPrintDoc: global.printDocument && hasDocument && structureAllowed,
  };
}
