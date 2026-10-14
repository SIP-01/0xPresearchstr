import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Generic hook for managing localStorage state
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  serializer?: {
    serialize: (value: T) => string;
    deserialize: (value: string) => T;
  }
) {
  const serialize = serializer?.serialize || JSON.stringify;
  const deserialize = serializer?.deserialize || JSON.parse;

  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? deserialize(item) : defaultValue;
    } catch (error) {
      console.warn(`Failed to load ${key} from localStorage:`, error);
      return defaultValue;
    }
  });

  const stateRef = useRef(state);
  const [hasStorageError, setHasStorageError] = useState(false);

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    const valueToStore = value instanceof Function ? value(stateRef.current) : value;
    try {
      localStorage.setItem(key, serialize(valueToStore));
      setHasStorageError(false);
    } catch (error) {
      console.warn(`Failed to save ${key} to localStorage:`, error);
      setHasStorageError(true);
    }
    // Keep settings and account synchronization usable when persistence is unavailable.
    stateRef.current = valueToStore;
    setState(valueToStore);
  }, [key, serialize]);

  // Sync with localStorage changes from other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          const next = deserialize(e.newValue);
          stateRef.current = next;
          setState(next);
          setHasStorageError(false);
        } catch (error) {
          console.warn(`Failed to sync ${key} from localStorage:`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, deserialize]);

  return [state, setValue, hasStorageError] as const;
}
