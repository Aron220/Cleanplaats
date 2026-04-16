import { describe, expect, it } from 'vitest';
import {
  getSortModeFromLabel,
  normalizeSortLabel,
} from '@/content/utils/sort';

describe('content sort utils', () => {
  it('normalizes sort labels', () => {
    expect(normalizeSortLabel('  Datum (nieuw-oud)  ')).toBe('datum (nieuw-oud)');
  });

  it('maps known labels to sort mode', () => {
    expect(getSortModeFromLabel('Standaard')).toBe('standard');
    expect(getSortModeFromLabel('Datum (nieuw-oud)')).toBe('date_new_old');
    expect(getSortModeFromLabel('Datum (oud-nieuw)')).toBe('date_old_new');
    expect(getSortModeFromLabel('Prijs (laag-hoog)')).toBe('price_low_high');
    expect(getSortModeFromLabel('Prijs (hoog-laag)')).toBe('price_high_low');
    expect(getSortModeFromLabel('Afstand')).toBe('distance');
  });

  it('returns null for unknown labels', () => {
    expect(getSortModeFromLabel('Onbekend')).toBeNull();
  });
});
