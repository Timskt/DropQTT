import { useState, useEffect } from 'react';

/** useState persisted to localStorage (JSON serialized) */
export function usePersistentState<T>(key: string, initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return JSON.parse(saved) as T;
    } catch (e) {
      console.warn(`Failed to restore ${key}:`, e);
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`Failed to persist ${key}:`, e);
    }
  }, [key, value]);

  return [value, setValue];
}

/** usePersistentState for plain strings (no JSON quotes wrapper, back-compat keys) */
export function usePersistentString(key: string, initial: string): [string, (value: string) => void] {
  const [value, setValue] = useState<string>(() => {
    return localStorage.getItem(key) ?? initial;
  });
  useEffect(() => {
    localStorage.setItem(key, value);
  }, [key, value]);
  return [value, setValue];
}
