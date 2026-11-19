import type { AssetDescriptor, ProjectDocumentV1 } from '../document/types';
import { cloneValue } from '../document/types';

const DB_NAME = 'lighttable-db';
const DB_VERSION = 1;
type AssetRecord = { id: string; descriptor: AssetDescriptor; blob: Blob };
type ProjectRecord = { projectId: string; document: ProjectDocumentV1; revision: number; savedAt: string };
type PluginValueRecord = { key: string; value: unknown };

let dbPromise: Promise<IDBDatabase | undefined> | undefined;
const memoryProjects = new Map<string, ProjectRecord>();
const memoryAssets = new Map<string, AssetRecord>();
const memoryPluginValues = new Map<string, unknown>();
const memoryPlugins = new Map<string, unknown>();
const assetDescriptors = new Map<string, AssetDescriptor>();

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (!('indexedDB' in globalThis)) return Promise.resolve(undefined);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'projectId' });
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pluginStorage')) db.createObjectStore('pluginStorage', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('plugins')) db.createObjectStore('plugins', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pluginFiles')) db.createObjectStore('pluginFiles', { keyPath: 'path' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      request.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  if (!globalThis.crypto?.subtle) throw new Error('Secure SHA-256 hashing requires a secure browser context (HTTPS or localhost).');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

export class ProjectRepository {
  /** Indicates whether writes are backed by IndexedDB rather than process memory. */
  async hasPersistentStorage(): Promise<boolean> { return Boolean(await openDatabase()); }

  async saveProject(document: ProjectDocumentV1, revision: number): Promise<void> {
    const db = await openDatabase();
    const record: ProjectRecord = { projectId: document.projectId, document: cloneValue(document), revision, savedAt: new Date().toISOString() };
    if (!db) {
      memoryProjects.set(document.projectId, record);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save project.'));
      tx.onabort = () => reject(tx.error ?? new Error('Project save was aborted.'));
    });
  }

  async loadProject(projectId: string): Promise<ProjectRecord | undefined> {
    const db = await openDatabase();
    if (!db) {
      const record = memoryProjects.get(projectId);
      return record ? cloneValue(record) : undefined;
    }
    const record = await requestResult(db.transaction('projects').objectStore('projects').get(projectId)) as ProjectRecord | undefined;
    return record ? cloneValue(record) : undefined;
  }

  async listProjects(): Promise<Array<{ projectId: string; name: string; updatedAt: string; durationTicks: number }>> {
    const db = await openDatabase();
    const records = db
      ? await requestResult(db.transaction('projects').objectStore('projects').getAll()) as ProjectRecord[]
      : [...memoryProjects.values()];
    return records.map(({ document }) => ({ projectId: document.projectId, name: document.name, updatedAt: document.updatedAt, durationTicks: document.document.durationTicks }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = await openDatabase();
    if (!db) { memoryProjects.delete(projectId); return; }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not delete project.'));
    });
  }

  async putAsset(blob: Blob, fileName?: string): Promise<AssetDescriptor> {
    const digest = await sha256Hex(blob);
    const descriptor: AssetDescriptor = {
      id: `sha256:${digest}`, mimeType: blob.type || 'application/octet-stream', byteLength: blob.size,
      sha256: digest, fileName,
    };
    const record: AssetRecord = { id: descriptor.id, descriptor, blob };
    assetDescriptors.set(descriptor.id, descriptor);
    const db = await openDatabase();
    if (!db) memoryAssets.set(record.id, record);
    else await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not store binary asset.'));
    });
    return descriptor;
  }

  async getAsset(assetId: string): Promise<Blob | undefined> {
    const db = await openDatabase();
    if (!db) return memoryAssets.get(assetId)?.blob;
    const record = await requestResult(db.transaction('assets').objectStore('assets').get(assetId)) as AssetRecord | undefined;
    return record?.blob;
  }

  /** Public SDK read-only asset surface. */
  get(assetId: string): Promise<Blob | undefined> { return this.getAsset(assetId); }

  getDescriptor(assetId: string): AssetDescriptor | undefined { return this.getAssetDescriptor(assetId); }

  getAssetDescriptor(assetId: string): AssetDescriptor | undefined {
    return assetDescriptors.get(assetId) ?? memoryAssets.get(assetId)?.descriptor;
  }

  async warmAssetDescriptors(descriptors: readonly AssetDescriptor[]): Promise<void> {
    for (const descriptor of descriptors) {
      assetDescriptors.set(descriptor.id, descriptor);
      const db = await openDatabase();
      if (!db) continue;
      const record = await requestResult(db.transaction('assets').objectStore('assets').get(descriptor.id)) as AssetRecord | undefined;
      if (!record) continue;
      assetDescriptors.set(descriptor.id, record.descriptor);
    }
  }

  async listAssets(descriptors: readonly AssetDescriptor[]): Promise<Array<{ descriptor: AssetDescriptor; blob: Blob }>> {
    const output: Array<{ descriptor: AssetDescriptor; blob: Blob }> = [];
    for (const descriptor of descriptors) {
      const blob = await this.getAsset(descriptor.id);
      if (!blob) throw new Error(`Project asset ${descriptor.id} is missing from local storage.`);
      output.push({ descriptor, blob });
    }
    return output;
  }

  async setPluginValue(pluginId: string, key: string, value: unknown): Promise<void> {
    const storageKey = `${pluginId}:${key}`;
    const db = await openDatabase();
    if (!db) { memoryPluginValues.set(storageKey, cloneValue(value)); return; }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pluginStorage', 'readwrite');
      tx.objectStore('pluginStorage').put({ key: storageKey, value: cloneValue(value) } satisfies PluginValueRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save plugin preference.'));
    });
  }

  async getPluginValue<T>(pluginId: string, key: string): Promise<T | undefined> {
    const storageKey = `${pluginId}:${key}`;
    const db = await openDatabase();
    if (!db) {
      const value = memoryPluginValues.get(storageKey);
      return value === undefined ? undefined : cloneValue(value as T);
    }
    const record = await requestResult(db.transaction('pluginStorage').objectStore('pluginStorage').get(storageKey)) as PluginValueRecord | undefined;
    return record ? cloneValue(record.value as T) : undefined;
  }

  async listPluginKeys(pluginId: string): Promise<string[]> {
    const db = await openDatabase();
    const keys = db
      ? await requestResult(db.transaction('pluginStorage').objectStore('pluginStorage').getAllKeys()) as string[]
      : [...memoryPluginValues.keys()];
    return keys.filter((key) => key.startsWith(`${pluginId}:`)).map((key) => key.slice(pluginId.length + 1));
  }

  async deletePluginValue(pluginId: string, key: string): Promise<void> {
    const storageKey = `${pluginId}:${key}`;
    const db = await openDatabase();
    if (!db) { memoryPluginValues.delete(storageKey); return; }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pluginStorage', 'readwrite');
      tx.objectStore('pluginStorage').delete(storageKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not remove plugin preference.'));
    });
  }

  async putInstalledPlugin(id: string, metadata: unknown): Promise<void> {
    const db = await openDatabase();
    if (!db) { memoryPlugins.set(id, cloneValue(metadata)); return; }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('plugins', 'readwrite');
      tx.objectStore('plugins').put({ id, metadata: cloneValue(metadata) });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not persist plugin metadata.'));
    });
  }

  async listInstalledPlugins(): Promise<Array<{ id: string; metadata: unknown }>> {
    const db = await openDatabase();
    if (!db) return [...memoryPlugins.entries()].map(([id, metadata]) => ({ id, metadata: cloneValue(metadata) }));
    return requestResult(db.transaction('plugins').objectStore('plugins').getAll()) as Promise<Array<{ id: string; metadata: unknown }>>;
  }
}

export class AutosaveController {
  private timeout: number | undefined;
  private savedRevision = -1;
  private latest?: { document: ProjectDocumentV1; revision: number };
  private drainPromise?: Promise<boolean>;

  constructor(
    private repository: ProjectRepository,
    private onStatus: (status: 'saved' | 'saving' | 'error', message?: string) => void,
    private delayMs = 900,
  ) {}

  schedule(document: ProjectDocumentV1, revision: number): void {
    if (!this.latest || revision >= this.latest.revision) this.latest = { document, revision };
    if (this.timeout !== undefined) window.clearTimeout(this.timeout);
    this.onStatus('saving');
    this.timeout = window.setTimeout(() => { void this.flush(this.latest!.document, this.latest!.revision); }, this.delayMs);
  }

  async flush(document: ProjectDocumentV1, revision: number): Promise<boolean> {
    if (!this.latest || revision >= this.latest.revision) this.latest = { document, revision };
    if (this.timeout !== undefined) {
      window.clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.drain();
    try { return await this.drainPromise; }
    finally { this.drainPromise = undefined; }
  }

  private async drain(): Promise<boolean> {
    while (this.latest && this.latest.revision > this.savedRevision) {
      const target = this.latest;
      this.latest = undefined;
      try {
        await this.repository.saveProject(target.document, target.revision);
        this.savedRevision = Math.max(this.savedRevision, target.revision);
        this.onStatus('saved');
      } catch (error) {
        const latest = this.latest as { document: ProjectDocumentV1; revision: number } | undefined;
        if (!latest || target.revision > latest.revision) this.latest = target;
        this.onStatus('error', error instanceof Error ? error.message : String(error));
        return false;
      }
    }
    return true;
  }

  dispose(): void {
    if (this.timeout !== undefined) window.clearTimeout(this.timeout);
    this.timeout = undefined;
  }
}
