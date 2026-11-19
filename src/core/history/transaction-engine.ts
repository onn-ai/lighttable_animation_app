import { cloneValue, type ProjectDocumentV1 } from '../document/types';
import { validateProject } from '../document/validate';

export interface TransactionOptions {
  expectedRevision?: number;
  undoable?: boolean;
}
export interface TransactionResult {
  committed: boolean;
  revision: number;
  conflict?: { expected: number; actual: number };
}
export interface HistoryEntry {
  id: string;
  label: string;
  revision: number;
  timestamp: string;
}
export type DocumentListener = (document: ProjectDocumentV1, revision: number, label: string) => void;

interface SnapshotEntry {
  before: ProjectDocumentV1;
  after: ProjectDocumentV1;
  label: string;
  revision: number;
  id: string;
}

/** Central immutable-snapshot transaction/history service. */
export class TransactionEngine {
  private current: ProjectDocumentV1;
  private currentRevision = 0;
  private undoStack: SnapshotEntry[] = [];
  private redoStack: SnapshotEntry[] = [];
  private listeners = new Set<DocumentListener>();
  private readonly maxEntries: number;

  constructor(initial: ProjectDocumentV1, maxEntries = 60) {
    validateProject(initial);
    this.current = cloneValue(initial);
    this.maxEntries = maxEntries;
  }

  get revision(): number { return this.currentRevision; }
  get document(): ProjectDocumentV1 { return cloneValue(this.current); }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get history(): HistoryEntry[] {
    return this.undoStack.map((entry) => ({ id: entry.id, label: entry.label, revision: entry.revision, timestamp: entry.after.updatedAt }));
  }

  subscribe(listener: DocumentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  transact(label: string, mutate: (draft: ProjectDocumentV1) => void, options: TransactionOptions = {}): TransactionResult {
    if (options.expectedRevision !== undefined && options.expectedRevision !== this.currentRevision) {
      return { committed: false, revision: this.currentRevision, conflict: { expected: options.expectedRevision, actual: this.currentRevision } };
    }
    const before = this.current;
    const draft = cloneValue(before);
    mutate(draft);
    draft.updatedAt = new Date().toISOString();
    validateProject(draft);
    const after = draft;
    this.current = after;
    this.currentRevision += 1;
    if (options.undoable !== false) {
      this.undoStack.push({ before, after: cloneValue(after), label, revision: this.currentRevision, id: makeTransactionId() });
      if (this.undoStack.length > this.maxEntries) this.undoStack.shift();
      this.redoStack = [];
    }
    this.publish(label);
    return { committed: true, revision: this.currentRevision };
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.current = cloneValue(entry.before);
    this.current.updatedAt = new Date().toISOString();
    this.currentRevision += 1;
    this.redoStack.push(entry);
    this.publish(`Undo ${entry.label}`);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.current = cloneValue(entry.after);
    this.current.updatedAt = new Date().toISOString();
    this.currentRevision += 1;
    this.undoStack.push(entry);
    this.publish(`Redo ${entry.label}`);
    return true;
  }

  replace(document: ProjectDocumentV1, label = 'Open project'): void {
    validateProject(document);
    this.current = cloneValue(document);
    this.currentRevision += 1;
    this.undoStack = [];
    this.redoStack = [];
    this.publish(label);
  }

  private publish(label: string): void {
    const snapshot = this.document;
    for (const listener of this.listeners) {
      try { listener(cloneValue(snapshot), this.currentRevision, label); }
      catch (error) { console.error('Document change listener failed after commit.', error); }
    }
  }
}

function makeTransactionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
