export function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid timestamp ${value}`);
  return parsed;
}

export function normalizeInstant(value: string): string {
  return new Date(instant(value)).toISOString();
}

export function systemInstant(): string {
  return new Date().toISOString();
}

export function instantIsAfter(left: string, right: string): boolean {
  return instant(left) > instant(right);
}

export function instantIsAtOrBefore(left: string, right: string): boolean {
  return instant(left) <= instant(right);
}
