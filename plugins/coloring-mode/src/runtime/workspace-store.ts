import type { JsonValue, PluginStorageApi } from "@lighttable/plugin-sdk";
import { STORAGE_KEY } from "../manifest.js";

export interface PaletteColor {
  [key: string]: JsonValue;
  id: string;
  name: string;
  color: string;
}
export interface ColoringOptions {
  [key: string]: JsonValue;
  tolerance: number;
  gapClose: number;
  sourceLayerIds: string[];
  opacity: number;
}
export interface WorkspaceState {
  [key: string]: JsonValue;
  palette: PaletteColor[];
  selectedColorId: string;
  options: ColoringOptions;
  draft: boolean;
  colorLayerEnabled: boolean;
}

const DEFAULT_PALETTE: PaletteColor[] = [
  { id: "line-white", name: "White", color: "#FFFFFF" },
  { id: "warm-skin", name: "Warm skin", color: "#F2BFA1" },
  { id: "soft-pink", name: "Soft pink", color: "#E88EAB" },
  { id: "sky-blue", name: "Sky blue", color: "#79BCE8" },
  { id: "leaf-green", name: "Leaf green", color: "#77B77A" },
  { id: "sun-yellow", name: "Sun yellow", color: "#F2D16B" },
  { id: "lavender", name: "Lavender", color: "#A895D5" },
  { id: "ink-black", name: "Ink black", color: "#24242B" },
];
interface StoredWorkspaceData { [key: string]: JsonValue; palette: PaletteColor[]; selectedColorId: string; options: ColoringOptions }

const DEFAULT_OPTIONS: ColoringOptions = { tolerance: 18, gapClose: 1, sourceLayerIds: [], opacity: 1 };

export function defaultWorkspaceState(): WorkspaceState {
  return {
    palette: DEFAULT_PALETTE.map((item) => ({ ...item })),
    selectedColorId: DEFAULT_PALETTE[0].id,
    options: { ...DEFAULT_OPTIONS, sourceLayerIds: [] },
    draft: false,
    colorLayerEnabled: true,
  };
}

export class WorkspaceStore {
  private state: WorkspaceState = defaultWorkspaceState();
  private listeners = new Set<(state: WorkspaceState) => void>();
  private storage?: PluginStorageApi;
  private persistQueue: Promise<void> = Promise.resolve();

  getSnapshot(): WorkspaceState {
    return {
      ...this.state,
      palette: this.state.palette.map((entry) => ({ ...entry })),
      options: { ...this.state.options, sourceLayerIds: [...this.state.options.sourceLayerIds] },
    };
  }

  subscribe(listener: (state: WorkspaceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(storage: PluginStorageApi): Promise<void> {
    this.storage = storage;
    const saved = await storage.get<StoredWorkspaceData>(STORAGE_KEY);
    if (isStoredState(saved)) {
      this.state = {
        ...defaultWorkspaceState(),
        palette: saved.palette.map((entry) => ({ ...entry })),
        selectedColorId: saved.palette.some((entry) => entry.id === saved.selectedColorId)
          ? saved.selectedColorId : saved.palette[0]?.id ?? DEFAULT_PALETTE[0].id,
        options: {
          tolerance: clampNumber(saved.options.tolerance, 0, 255, DEFAULT_OPTIONS.tolerance),
          gapClose: Math.round(clampNumber(saved.options.gapClose, 0, 8, DEFAULT_OPTIONS.gapClose)),
          sourceLayerIds: [...saved.options.sourceLayerIds],
          opacity: clampNumber(saved.options.opacity, 0, 1, 1),
        },
      };
    }
    this.emit();
  }

  setDraft(draft: boolean): void {
    if (this.state.draft === draft) return;
    this.state = { ...this.state, draft };
    this.emit();
  }

  setColorLayerEnabled(enabled: boolean): void {
    if (this.state.colorLayerEnabled === enabled) return;
    this.state = { ...this.state, colorLayerEnabled: enabled };
    this.emit();
  }

  selectColor(id: string): void {
    if (!this.state.palette.some((item) => item.id === id)) return;
    this.state = { ...this.state, selectedColorId: id };
    this.emit();
  }

  setSelectedColor(color: string, name = "Sampled color"): string {
    if (!isColor(color)) throw new TypeError("Color must be a six- or eight-digit sRGB hex value.");
    const normalized = color.toUpperCase();
    const existing = this.state.palette.find((entry) => entry.color.toUpperCase() === normalized);
    if (existing) {
      this.selectColor(existing.id);
      return existing.id;
    }
    return this.addColor(normalized, name, true);
  }

  addColor(color: string, name: string, select = true): string {
    if (!isColor(color)) throw new TypeError("Color must be a six- or eight-digit sRGB hex value.");
    const id = makeId();
    const entry = { id, name: cleanName(name, "New color"), color: color.toUpperCase() };
    this.state = {
      ...this.state,
      palette: [...this.state.palette, entry],
      selectedColorId: select ? id : this.state.selectedColorId,
    };
    this.emit();
    return id;
  }

  renameColor(id: string, name: string): void {
    const cleaned = cleanName(name, "Color");
    this.state = { ...this.state, palette: this.state.palette.map((entry) => entry.id === id ? { ...entry, name: cleaned } : entry) };
    this.emit();
  }

  updateColor(id: string, color: string): void {
    if (!isColor(color)) return;
    this.state = { ...this.state, palette: this.state.palette.map((entry) => entry.id === id ? { ...entry, color: color.toUpperCase() } : entry) };
    this.emit();
  }

  deleteColor(id: string): void {
    if (this.state.palette.length <= 1) return;
    const palette = this.state.palette.filter((entry) => entry.id !== id);
    const selectedColorId = this.state.selectedColorId === id ? palette[0].id : this.state.selectedColorId;
    this.state = { ...this.state, palette, selectedColorId };
    this.emit();
  }

  async flush(): Promise<void> {
    await this.persistQueue;
  }

  updateOptions(patch: Partial<ColoringOptions>): void {
    const next: ColoringOptions = {
      ...this.state.options,
      ...patch,
      tolerance: clampNumber(patch.tolerance ?? this.state.options.tolerance, 0, 255, this.state.options.tolerance),
      gapClose: Math.round(clampNumber(patch.gapClose ?? this.state.options.gapClose, 0, 8, this.state.options.gapClose)),
      opacity: clampNumber(patch.opacity ?? this.state.options.opacity, 0, 1, this.state.options.opacity),
      sourceLayerIds: patch.sourceLayerIds ? [...new Set(patch.sourceLayerIds.filter((id) => typeof id === "string" && id.length > 0))] : [...this.state.options.sourceLayerIds],
    };
    this.state = { ...this.state, options: next };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
    if (this.storage) {
      const persisted: StoredWorkspaceData = {
        palette: snapshot.palette,
        selectedColorId: snapshot.selectedColorId,
        options: snapshot.options,
      };
      this.persistQueue = this.persistQueue.then(() => this.storage!.set(STORAGE_KEY, persisted)).catch(() => {
        // Storage failures do not invalidate the in-memory coloring workspace.
      });
    }
  }
}

function isStoredState(value: unknown): value is StoredWorkspaceData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const options = data.options as Record<string, unknown> | null;
  return Array.isArray(data.palette) && data.palette.length > 0
    && data.palette.every((entry) => !!entry && typeof entry === "object"
      && typeof (entry as Record<string, unknown>).id === "string"
      && typeof (entry as Record<string, unknown>).name === "string"
      && isColor((entry as Record<string, unknown>).color))
    && typeof data.selectedColorId === "string"
    && !!options && typeof options === "object"
    && typeof options.tolerance === "number" && typeof options.gapClose === "number"
    && Array.isArray(options.sourceLayerIds)
    && options.sourceLayerIds.every((id) => typeof id === "string")
    && (options.opacity === undefined || typeof options.opacity === "number");
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}
function clampNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function cleanName(value: string, fallback: string): string {
  const cleaned = value.trim().slice(0, 48);
  return cleaned || fallback;
}
function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `color-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
