declare module 'persistentmap' {
  interface Options {
    maxFileSize?: number;
  }

  interface PersistentMap<K, V> extends Omit<Map<K, V>, 'delete' | 'set'> {
    load(): Promise<this>;
    compact(): Promise<void>;
    flush(): Promise<void>;

    delete(key: K): Promise<void>;
    set(key: K, value: V): Promise<void>;
  }

  interface MapConstructor {
    new <K, V>(filepath: string, options?: Options): PersistentMap<K, V>;
    readonly prototype: PersistentMap<any, any>;
  }
  const PersistentMap: MapConstructor;

  export default PersistentMap;
}
