import { describe, expect, it } from 'vitest';
import { parseStoredJson, stringifyStoredJson } from '@/shared/utils/serialization';

describe('parseStoredJson', () => {
  it('parses JSON string values', () => {
    const parsed = parseStoredJson<{ darkMode: boolean }>('{"darkMode":true}');
    expect(parsed).toEqual({ darkMode: true });
  });

  it('returns object input unchanged as typed value', () => {
    const parsed = parseStoredJson<{ resultsPerPage: number }>({ resultsPerPage: 50 });
    expect(parsed).toEqual({ resultsPerPage: 50 });
  });

  it('returns undefined for invalid JSON strings', () => {
    const parsed = parseStoredJson<{ foo: string }>('{invalid');
    expect(parsed).toBeUndefined();
  });

  it('returns undefined for nullish values', () => {
    expect(parseStoredJson(null)).toBeUndefined();
    expect(parseStoredJson(undefined)).toBeUndefined();
  });
});

describe('stringifyStoredJson', () => {
  it('serializes values to JSON strings', () => {
    expect(stringifyStoredJson({ removeTopAds: true })).toBe('{"removeTopAds":true}');
  });
});
