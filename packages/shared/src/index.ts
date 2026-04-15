export type FieldType = 'text' | 'checkbox' | 'counter-tally' | 'counter-numeric' | 'date';

export interface FieldModel {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: FieldType;
}
