export type FieldType = 'text' | 'checkbox' | 'counter-tally' | 'counter-numeric' | 'date';

export type FieldStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
  textAlign: 'left' | 'center' | 'right' | 'justify';
  color: string;
  highlightColor?: string;
  checkSize?: number;
  maskBackground?: boolean;
  backgroundColor?: string;
  dateFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  datePlaceholder?: string;
  dateDefaultToday?: boolean;
  overflowGroupId?: string;
  overflowOrder?: number;
  overflowMaxFields?: number;
  overflowOnEnd?: "truncate" | "block";
  overflowInteractionMode?: 'distributed' | 'continuous' | 'fused';
  carryToNextPage?: boolean;
  carryValueMode?: 'keep' | 'clear';
};

export const defaultFieldStyle: FieldStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 14,
  fontWeight: 'normal',
  fontStyle: 'normal',
  textDecoration: 'none',
  textAlign: 'left',
  color: '#000000',
  highlightColor: '#ffff00',
  dateFormat: 'DD/MM/YYYY',
};

export type FieldModel = {
  id: string;
  label: string;
  value: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: FieldType;
  style: FieldStyle;
  locked: boolean;
  overlayVisible: boolean;
  pageNumber: number;
};

export type DocumentPreset = {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
};

export const defaultDocumentPreset: DocumentPreset = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 14,
  fontWeight: 'normal',
  color: '#000000',
};

export type TemplateModel = {
  id: string;
  name: string;
  sourceFileId?: string;
  folderId?: string | null;
  rotation?: 0 | 90 | 180 | 270;
  fields: FieldModel[];
  createdAt: string;
  updatedAt: string;
};
