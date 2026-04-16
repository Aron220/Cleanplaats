export function parseJsonRecord(input: unknown): Record<string, unknown> {
  if (input == null) return {};

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  if (typeof input === 'object') {
    return input as Record<string, unknown>;
  }

  return {};
}

export function parseStoredJson<T>(input: unknown): T | undefined {
  if (input == null) {
    return undefined;
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as T;
      return parsed;
    } catch {
      return undefined;
    }
  }

  if (typeof input === 'object') {
    return input as T;
  }

  return undefined;
}

export function stringifyStoredJson(value: unknown): string {
  return JSON.stringify(value);
}
