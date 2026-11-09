import { timingSafeEqual } from 'node:crypto';

export function redactToken(value: string | undefined): string {
  if (!value) return '<missing>';
  return `${value.slice(0, 3)}…${value.slice(-2)}`;
}

export function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function bearerToken(authorization: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}
