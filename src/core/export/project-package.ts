import type { ProjectDocumentV1 } from '../document/types';
import { validateProject } from '../document/validate';
import { ProjectRepository, sha256Hex } from '../storage/project-repository';
import { createZip, normalizeZipPath, readZip } from './zip';

interface PackageAssetEntry {
  id: string;
  path: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
}
interface PackageManifest {
  format: 'lighttable.package';
  packageVersion: 1;
  projectId: string;
  projectSchemaVersion: string;
  documentPath: 'document.json';
  assets: PackageAssetEntry[];
  createdAt: string;
}

export async function exportProjectPackage(project: ProjectDocumentV1, repository: ProjectRepository): Promise<Blob> {
  validateProject(project);
  const storedAssets = await repository.listAssets(project.assets);
  const manifest: PackageManifest = {
    format: 'lighttable.package', packageVersion: 1, projectId: project.projectId,
    projectSchemaVersion: project.schemaVersion, documentPath: 'document.json', createdAt: new Date().toISOString(),
    assets: storedAssets.map(({ descriptor }) => ({
      id: descriptor.id,
      path: `assets/${descriptor.sha256}.${extensionForMime(descriptor.mimeType)}`,
      mimeType: descriptor.mimeType,
      byteLength: descriptor.byteLength,
      sha256: descriptor.sha256,
    })),
  };
  const entries: Array<{ path: string; data: string | Uint8Array }> = [
    { path: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { path: 'document.json', data: JSON.stringify(project, null, 2) },
  ];
  for (const [index, item] of storedAssets.entries()) {
    entries.push({ path: manifest.assets[index].path, data: new Uint8Array(await item.blob.arrayBuffer()) });
  }
  return createZip(entries);
}

export async function importProjectPackage(blob: Blob, repository: ProjectRepository): Promise<ProjectDocumentV1> {
  const files = await readZip(blob);
  const manifestBytes = files.get('manifest.json');
  const documentBytes = files.get('document.json');
  if (!manifestBytes || !documentBytes) throw new Error('This ZIP is missing the LightTable manifest or document.');
  const manifest = parseJson<unknown>(manifestBytes, 'package manifest');
  const project = parseJson<unknown>(documentBytes, 'project document');
  if (!isRecord(manifest)) throw new Error('The LightTable package manifest must be a JSON object.');
  if (!isRecord(project)) throw new Error('The LightTable project document must be a JSON object.');
  if (manifest.format !== 'lighttable.package' || manifest.packageVersion !== 1) throw new Error('Unsupported LightTable project package version.');
  if (manifest.documentPath !== 'document.json') throw new Error('The package manifest must reference document.json.');
  if (typeof manifest.projectId !== 'string' || manifest.projectId !== project.projectId || manifest.projectSchemaVersion !== project.schemaVersion) {
    throw new Error('Package manifest and document metadata do not match.');
  }
  if (typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('Package manifest createdAt must be a valid ISO date.');
  if (!Array.isArray(manifest.assets)) throw new Error('Package manifest assets must be an array.');
  const typedProject = project as unknown as ProjectDocumentV1;
  validateProject(typedProject);

  const manifestById = new Map<string, PackageAssetEntry>();
  const seenPaths = new Set<string>(['manifest.json', 'document.json']);
  for (const rawEntry of manifest.assets) {
    if (!isRecord(rawEntry)) throw new Error('Package manifest contains an invalid asset entry.');
    const entry = rawEntry as unknown as PackageAssetEntry;
    if (typeof entry.id !== 'string' || !entry.id || manifestById.has(entry.id)) throw new Error(`Package manifest contains a missing or duplicate asset ID: ${String(entry.id)}.`);
    if (typeof entry.path !== 'string') throw new Error(`Asset ${entry.id} path is invalid.`);
    const safePath = normalizeZipPath(entry.path);
    if (!safePath.startsWith('assets/') || seenPaths.has(safePath)) throw new Error(`Asset ${entry.id} path is invalid or duplicated.`);
    seenPaths.add(safePath);
    if (typeof entry.mimeType !== 'string' || !entry.mimeType) throw new Error(`Asset ${entry.id} MIME type is invalid.`);
    if (!Number.isInteger(entry.byteLength) || entry.byteLength < 0) throw new Error(`Asset ${entry.id} byteLength is invalid.`);
    if (typeof entry.sha256 !== 'string' || !/^[\da-f]{64}$/i.test(entry.sha256)) throw new Error(`Asset ${entry.id} SHA-256 is invalid.`);
    manifestById.set(entry.id, entry);
  }

  const descriptors = new Map(typedProject.assets.map((asset) => [asset.id, asset]));
  if (manifestById.size !== typedProject.assets.length) throw new Error('Project asset inventory does not match its package manifest.');
  const verifiedAssets: Array<{ entry: PackageAssetEntry; blob: Blob }> = [];
  for (const [assetId, entry] of manifestById) {
    const descriptor = descriptors.get(assetId);
    if (!descriptor || descriptor.sha256 !== entry.sha256 || descriptor.byteLength !== entry.byteLength || descriptor.mimeType !== entry.mimeType) {
      throw new Error(`Asset descriptor mismatch for ${assetId}.`);
    }
    const assetBytes = files.get(entry.path);
    if (!assetBytes) throw new Error(`The project package is missing asset ${entry.path}.`);
    if (assetBytes.byteLength !== entry.byteLength) throw new Error(`Asset length validation failed for ${assetId}.`);
    const assetBlob = new Blob([assetBytes], { type: entry.mimeType });
    if (await sha256Hex(assetBlob) !== entry.sha256) throw new Error(`Asset integrity validation failed for ${assetId}.`);
    verifiedAssets.push({ entry, blob: assetBlob });
  }

  // Verify every asset before persisting any of them or replacing the active project.
  for (const { entry, blob: assetBlob } of verifiedAssets) {
    const descriptor = descriptors.get(entry.id)!;
    const stored = await repository.putAsset(assetBlob, descriptor.fileName);
    if (stored.sha256 !== entry.sha256 || stored.byteLength !== entry.byteLength || stored.id !== descriptor.id) {
      throw new Error(`Asset content address mismatch for ${entry.id}.`);
    }
  }
  await repository.saveProject(typedProject, 0);
  await repository.warmAssetDescriptors(typedProject.assets);
  return typedProject;
}

function parseJson<T>(bytes: Uint8Array, description: string): T {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T; }
  catch (error) { throw new Error(`The ${description} is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`); }
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function extensionForMime(mime: string): string {
  const map: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/x-lighttable-alpha-mask': 'mask' };
  return map[mime] ?? 'bin';
}
