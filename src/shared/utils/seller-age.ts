import type { SellerAgeThresholdUnit } from '@/shared/types/state';

export const normalizeSellerAgeText = (text: string): string =>
  text.trim().toLowerCase().replace(/\s+/g, ' ');

const SELLER_AGE_REGEX =
  /(\d+)\s+(dag|dagen|day|days|jour|jours|week|weken|semaine|semaines|maand|maanden|month|months|mois|jaar|jaren|year|years|an|ans)\b/;

export const parseSellerAgeToDays = (input: string): number | null => {
  const normalized = normalizeSellerAgeText(input);
  const match = normalized.match(SELLER_AGE_REGEX);
  if (!match) return null;

  const amountRaw = match[1];
  const unit = match[2] ?? '';
  if (!amountRaw || !unit) return null;

  const amount = Number.parseInt(amountRaw, 10);
  if (!Number.isFinite(amount) || amount < 0) return null;

  if (['dag', 'dagen', 'day', 'days', 'jour', 'jours'].includes(unit)) {
    return amount;
  }

  if (['week', 'weken', 'semaine', 'semaines'].includes(unit)) {
    return amount * 7;
  }

  if (['maand', 'maanden', 'month', 'months', 'mois'].includes(unit)) {
    return amount * 30;
  }

  if (['jaar', 'jaren', 'year', 'years', 'an', 'ans'].includes(unit)) {
    return amount * 365;
  }

  return null;
};

export const thresholdToDays = (
  value: number,
  unit: SellerAgeThresholdUnit,
): number => {
  const normalizedValue = Math.max(1, Number.isFinite(value) ? Math.trunc(value) : 1);
  switch (unit) {
    case 'days':
      return normalizedValue;
    case 'weeks':
      return normalizedValue * 7;
    case 'years':
      return normalizedValue * 365;
    case 'months':
    default:
      return normalizedValue * 30;
  }
};
