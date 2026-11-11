/** Minimal async key-value store, implemented by `chrome.storage.local` and by tests. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  keys(): Promise<string[]>;
}

export function createMemoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map<string, unknown>(Object.entries(structuredClone(initial)));
  return {
    get: <T>(key: string) => Promise.resolve(structuredClone(data.get(key)) as T | undefined),
    set: (key, value) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
    remove: (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        data.delete(key);
      }
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...data.keys()]),
  };
}
