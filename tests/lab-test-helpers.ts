import { expect } from 'vitest';
import * as library from '../src/index.js';

export function exportedFunction(name: string): (...args: any[]) => any {
  const value = (library as Record<string, unknown>)[name];
  expect(typeof value).toBe('function');
  return value as (...args: any[]) => any;
}

export function exportedValue(name: string): any {
  return (library as Record<string, unknown>)[name];
}
