import { describe, expect, it } from 'vitest';
import { parseSellerAgeToDays, thresholdToDays } from '@/shared/utils/seller-age';

describe('seller age parsing', () => {
  it('parses dutch, french and english units', () => {
    expect(parseSellerAgeToDays('3 dagen op Marktplaats')).toBe(3);
    expect(parseSellerAgeToDays('2 semaines')).toBe(14);
    expect(parseSellerAgeToDays('1 year active')).toBe(365);
  });

  it('returns null for unparseable text', () => {
    expect(parseSellerAgeToDays('nieuw account')).toBeNull();
    expect(parseSellerAgeToDays('')).toBeNull();
  });

  it('converts threshold to days', () => {
    expect(thresholdToDays(2, 'days')).toBe(2);
    expect(thresholdToDays(2, 'weeks')).toBe(14);
    expect(thresholdToDays(2, 'months')).toBe(60);
    expect(thresholdToDays(2, 'years')).toBe(730);
  });
});
