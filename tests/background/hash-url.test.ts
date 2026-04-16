import { describe, expect, it } from 'vitest';
import {
  buildHashOptions,
  getModifiedUrlIfNeeded,
  parseHashOptions,
} from '../../src/background/services/hash-url';

describe('background/hash-url', () => {
  it('parses hash options into a key/value map', () => {
    const parsed = parseHashOptions('#limit:50|sortBy:PRICE|sortOrder:INCREASING');
    expect(parsed).toEqual({
      limit: '50',
      sortBy: 'PRICE',
      sortOrder: 'INCREASING',
    });
  });

  it('builds hash options from map entries', () => {
    const hash = buildHashOptions({
      limit: '100',
      sortBy: 'PRICE',
      sortOrder: 'DECREASING',
    });

    expect(hash).toBe('#limit:100|sortBy:PRICE|sortOrder:DECREASING');
  });

  it('adds missing limit parameter', () => {
    const result = getModifiedUrlIfNeeded({
      urlString: 'https://www.marktplaats.nl/l/auto-s/#',
      resultsPerPage: '50',
      defaultSortMode: 'standard',
      sortPreferenceSource: 'cleanplaats',
    });

    expect(result).toBeTruthy();
    const parsed = parseHashOptions(new URL(result!).hash);
    expect(parsed.limit).toBe('50');
  });

  it('adds configured sort when cleanplaats controls sort mode', () => {
    const result = getModifiedUrlIfNeeded({
      urlString: 'https://www.marktplaats.nl/l/auto-s/#limit:50',
      resultsPerPage: '50',
      defaultSortMode: 'price_low_high',
      sortPreferenceSource: 'cleanplaats',
    });

    expect(result).toBeTruthy();
    const parsed = parseHashOptions(new URL(result!).hash);
    expect(parsed.sortBy).toBe('PRICE');
    expect(parsed.sortOrder).toBe('INCREASING');
  });

  it('removes explicit sort when default sort mode is standard', () => {
    const result = getModifiedUrlIfNeeded({
      urlString:
        'https://www.marktplaats.nl/l/auto-s/#limit:30|sortBy:PRICE|sortOrder:INCREASING',
      resultsPerPage: '30',
      defaultSortMode: 'standard',
      sortPreferenceSource: 'cleanplaats',
    });

    expect(result).toBeTruthy();
    const parsed = parseHashOptions(new URL(result!).hash);
    expect(parsed.limit).toBe('30');
    expect(parsed.sortBy).toBeUndefined();
    expect(parsed.sortOrder).toBeUndefined();
  });

  it('returns null when no rewrite is needed', () => {
    const result = getModifiedUrlIfNeeded({
      urlString: 'https://www.marktplaats.nl/l/auto-s/#limit:30',
      resultsPerPage: '30',
      defaultSortMode: 'standard',
      sortPreferenceSource: 'cleanplaats',
    });

    expect(result).toBeNull();
  });
});
