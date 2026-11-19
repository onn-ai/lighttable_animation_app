import type { JsonValue, ProjectDocumentV1 } from './types';
import { MAX_LAYERS_PER_CEL_V1, PROJECT_FORMAT, PROJECT_SCHEMA_VERSION } from './types';

export class DocumentValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Project validation failed: ${issues.join('; ')}`);
    this.name = 'DocumentValidationError';
    this.issues = issues;
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

/** Validate parsed project data before it is allowed into the live document engine. */
export function validateProject(project: ProjectDocumentV1): void {
  const issues: string[] = [];
  if (!isRecord(project)) throw new DocumentValidationError(['project root must be an object']);

  const raw = project as unknown as Record<string, unknown>;
  const ids = new Set<string>();
  const claim = (value: unknown, label: string) => {
    const id = typeof value === 'string' ? value : '';
    if (!id || ids.has(id)) issues.push(`${label} ID is empty or duplicated: ${id}`);
    if (id) ids.add(id);
  };

  if (raw.format !== PROJECT_FORMAT) issues.push('format must be lighttable.project');
  if (raw.schemaVersion !== PROJECT_SCHEMA_VERSION) issues.push(`unsupported schema version: ${String(raw.schemaVersion)}`);
  if (typeof raw.projectId !== 'string' || !raw.projectId) issues.push('projectId is required');
  if (typeof raw.name !== 'string' || !raw.name.trim()) issues.push('project name is required');
  if (typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))) issues.push('createdAt must be an ISO date');
  if (typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))) issues.push('updatedAt must be an ISO date');

  const settings = isRecord(raw.document) ? raw.document : undefined;
  if (!settings) issues.push('document settings must be an object');
  if (!settings || !finite(settings.width) || settings.width <= 0 || settings.width > 16384) issues.push('document width must be between 0 and 16384');
  if (!settings || !finite(settings.height) || settings.height <= 0 || settings.height > 16384) issues.push('document height must be between 0 and 16384');
  if (settings?.colorSpace !== 'srgb') issues.push('document colorSpace must be srgb');
  const frameRate = settings && isRecord(settings.frameRate) ? settings.frameRate : undefined;
  if (!frameRate || !Number.isInteger(frameRate.numerator) || Number(frameRate.numerator) <= 0) issues.push('frame-rate numerator must be a positive integer');
  if (!frameRate || !Number.isInteger(frameRate.denominator) || Number(frameRate.denominator) <= 0) issues.push('frame-rate denominator must be a positive integer');
  const durationTicks = settings?.durationTicks;
  if (!Number.isInteger(durationTicks) || Number(durationTicks) < 0) issues.push('durationTicks must be a non-negative integer');
  const physicalSize = settings && isRecord(settings.physicalSizeMm) ? settings.physicalSizeMm : undefined;
  if (settings?.physicalSizeMm && (!physicalSize || !finite(physicalSize.width) || physicalSize.width <= 0 || !finite(physicalSize.height) || physicalSize.height <= 0)) {
    issues.push('physicalSizeMm dimensions must be finite and positive');
  }
  const background = settings && isRecord(settings.background) ? settings.background : undefined;
  if (background?.kind === 'solid' && (typeof background.color !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(background.color))) {
    issues.push('solid background color must be #RRGGBB or #RRGGBBAA');
  }
  if (!background || !['solid', 'transparent'].includes(String(background.kind))) issues.push('background kind must be solid or transparent');

  const cels = isRecord(raw.cels) ? raw.cels : {};
  if (!isRecord(raw.cels)) issues.push('cels must be an object keyed by cel ID');
  const celIds = new Set(Object.keys(cels));
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  if (!Array.isArray(raw.tracks) || tracks.length < 1) issues.push('at least one animation track is required');
  for (const rawTrack of tracks) {
    if (!isRecord(rawTrack)) { issues.push('track entries must be objects'); continue; }
    const track = rawTrack;
    const trackId = typeof track.id === 'string' ? track.id : '<invalid>';
    claim(track.id, 'track');
    if (typeof track.name !== 'string' || !track.name.trim()) issues.push(`track ${trackId} needs a name`);
    if (!finite(track.opacity) || track.opacity < 0 || track.opacity > 1) issues.push(`track ${trackId} opacity must be in [0,1]`);
    if (!Array.isArray(track.clips)) { issues.push(`track ${trackId} clips must be an array`); continue; }
    const clips = track.clips.filter(isRecord).sort((a, b) => Number(a.startTick) - Number(b.startTick));
    if (clips.length !== track.clips.length) issues.push(`track ${trackId} contains invalid clip entries`);
    let previousEnd = -1;
    for (const clip of clips) {
      const clipId = typeof clip.id === 'string' ? clip.id : '<invalid>';
      claim(clip.id, 'clip');
      const start = clip.startTick;
      const duration = clip.durationTicks;
      const startValid = Number.isInteger(start) && Number(start) >= 0;
      const durationValid = Number.isInteger(duration) && Number(duration) >= 1;
      if (!startValid) issues.push(`clip ${clipId} startTick must be a non-negative integer`);
      if (!durationValid) issues.push(`clip ${clipId} duration must be a positive integer`);
      if (startValid && durationValid) {
        if (Number(start) < previousEnd) issues.push(`clips overlap on track ${trackId}`);
        previousEnd = Number(start) + Number(duration);
        if (Number.isInteger(durationTicks) && previousEnd > Number(durationTicks)) issues.push(`clip ${clipId} ends after document duration`);
      }
      if (typeof clip.celId !== 'string' || !celIds.has(clip.celId) || !cels[clip.celId]) {
        issues.push(`clip ${clipId} references missing cel ${String(clip.celId)}`);
      }
    }
  }

  for (const [key, rawCel] of Object.entries(cels)) {
    if (!isRecord(rawCel)) { issues.push(`cel ${key} must be an object`); continue; }
    const cel = rawCel;
    if (key !== cel.id) issues.push(`cel key ${key} does not match cel.id`);
    claim(cel.id, 'cel');
    if (!Array.isArray(cel.layers) || cel.layers.length > MAX_LAYERS_PER_CEL_V1) {
      issues.push(`cel ${key} may contain at most ${MAX_LAYERS_PER_CEL_V1} layers`);
      continue;
    }
    for (const rawLayer of cel.layers) {
      if (!isRecord(rawLayer)) { issues.push(`cel ${key} contains an invalid layer`); continue; }
      const layer = rawLayer;
      const layerId = typeof layer.id === 'string' ? layer.id : '<invalid>';
      claim(layer.id, 'layer');
      if (layer.kind !== 'content') issues.push(`layer ${layerId} must have kind content`);
      if (!finite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) issues.push(`layer ${layerId} opacity must be in [0,1]`);
      if (!Array.isArray(layer.nodes)) { issues.push(`layer ${layerId} nodes must be an array`); continue; }
      for (const rawNode of layer.nodes) {
        if (!isRecord(rawNode)) { issues.push(`layer ${layerId} contains an invalid node`); continue; }
        const node = rawNode;
        const nodeId = typeof node.id === 'string' ? node.id : '<invalid>';
        claim(node.id, 'node');
        if (typeof node.type !== 'string' || !/^[a-z0-9]+([.-][a-z0-9]+)+$/.test(node.type)) issues.push(`node ${nodeId} type must be namespaced`);
        if (!Number.isInteger(node.typeVersion) || Number(node.typeVersion) < 1) issues.push(`node ${nodeId} typeVersion must be a positive integer`);
        if (!Array.isArray(node.transform) || node.transform.length !== 6 || !node.transform.every(finite)) issues.push(`node ${nodeId} transform must contain six finite values`);
        if (!isJsonValue(node.data)) issues.push(`node ${nodeId} payload is not JSON-safe`);
        if (node.type === 'core.path' && isJsonValue(node.data) && isRecord(node.data)) {
          const data = node.data;
          const paint = isRecord(data.paint) ? data.paint : undefined;
          if (!Array.isArray(data.samples) || data.samples.length < 1) issues.push(`core.path ${nodeId} needs at least one sample`);
          if (!finite(paint?.width) || Number(paint?.width) <= 0) issues.push(`core.path ${nodeId} width must be positive`);
          if (!finite(paint?.opacity) || Number(paint?.opacity) < 0 || Number(paint?.opacity) > 1) issues.push(`core.path ${nodeId} opacity must be in [0,1]`);
          if (typeof paint?.color !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(paint.color)) issues.push(`core.path ${nodeId} color is invalid`);
          for (const sample of Array.isArray(data.samples) ? data.samples : []) {
            if (!isRecord(sample) || !finite(sample.x) || !finite(sample.y) || !finite(sample.pressure) || sample.pressure < 0 || sample.pressure > 1) {
              issues.push(`core.path ${nodeId} has an invalid sample`);
            }
          }
        }
      }
    }
  }

  const assets = Array.isArray(raw.assets) ? raw.assets : [];
  if (!Array.isArray(raw.assets)) issues.push('assets must be an array');
  const assetIds = new Set<string>();
  for (const rawAsset of assets) {
    if (!isRecord(rawAsset)) { issues.push('asset entries must be objects'); continue; }
    const asset = rawAsset;
    if (typeof asset.id !== 'string' || !asset.id) issues.push('asset ID is required');
    else if (assetIds.has(asset.id)) issues.push(`duplicate asset ${asset.id}`);
    else assetIds.add(asset.id);
    if (!Number.isInteger(asset.byteLength) || Number(asset.byteLength) < 0) issues.push(`asset ${String(asset.id)} byteLength is invalid`);
    if (typeof asset.sha256 !== 'string' || !/^[\da-f]{64}$/i.test(asset.sha256)) issues.push(`asset ${String(asset.id)} SHA-256 is invalid`);
  }

  if (!isJsonValue(raw.extensions ?? {})) issues.push('project extensions are not JSON-safe');
  if (!isJsonValue(raw.metadata ?? {})) issues.push('project metadata is not JSON-safe');
  if (issues.length) throw new DocumentValidationError(issues);
}
