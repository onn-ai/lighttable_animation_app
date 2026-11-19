import type { ProjectDocumentV1 } from '../document/types';
import { RendererRegistry } from '../rendering/renderer-registry';
import { renderTickToCanvas } from '../rendering/render-service';
import type { ProjectRepository } from '../storage/project-repository';
import { createZip } from './zip';

export interface ExportProgress { (fraction: number, label: string): void }
export interface PNGExportOptions { transparent: boolean; revision?: number; signal?: AbortSignal; onProgress?: ExportProgress }

export async function exportPNGSequence(
  snapshot: ProjectDocumentV1,
  registry: RendererRegistry,
  repository: ProjectRepository,
  options: PNGExportOptions,
): Promise<Blob> {
  const entries: Array<{ path: string; data: Uint8Array }> = [];
  const count = snapshot.document.durationTicks;
  for (let tick = 0; tick < count; tick += 1) {
    throwIfAborted(options.signal);
    const rendered = await renderTickToCanvas(snapshot, tick, registry, repository, {
      intent: 'export', background: options.transparent ? 'transparent' : 'white', strictMissingRenderers: true, revision: options.revision, signal: options.signal,
    });
    const png = await canvasBlob(rendered.canvas, 'image/png');
    entries.push({ path: `frames/frame_${String(tick + 1).padStart(4, '0')}.png`, data: new Uint8Array(await png.arrayBuffer()) });
    options.onProgress?.((tick + 1) / count, `Rendering frame ${tick + 1} of ${count}`);
  }
  return createZip([
    { path: 'README.txt', data: `LightTable PNG sequence\nProject: ${snapshot.name}\nFrames: ${count}\nResolution: ${snapshot.document.width} x ${snapshot.document.height}\nBackground: ${options.transparent ? 'transparent' : 'white'}\n` },
    ...entries,
  ]);
}

export interface PDFExportOptions {
  includeAcmePegBar: boolean;
  revision?: number;
  signal?: AbortSignal;
  onProgress?: ExportProgress;
}

interface PdfPageInput {
  jpeg: Uint8Array;
  imageWidthPx: number;
  imageHeightPx: number;
  pageWidth: number;
  pageHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  frameNumber: number;
  includePegBar: boolean;
}

/** Fit-to-A4 is the baseline. Calibrated 1:1 is intentionally separate. */
export async function exportA4PDF(
  snapshot: ProjectDocumentV1,
  registry: RendererRegistry,
  repository: ProjectRepository,
  options: PDFExportOptions,
): Promise<Blob> {
  const pages: PdfPageInput[] = [];
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 34;
  const imageBox = {
    x: margin + (options.includeAcmePegBar ? 30 : 0),
    y: margin,
    width: pageWidth - margin * 2 - (options.includeAcmePegBar ? 30 : 0),
    height: pageHeight - margin * 2 - 14,
  };
  const scale = Math.min(imageBox.width / snapshot.document.width, imageBox.height / snapshot.document.height);
  const imageWidth = snapshot.document.width * scale;
  const imageHeight = snapshot.document.height * scale;
  const imageX = imageBox.x + (imageBox.width - imageWidth) / 2;
  const imageY = imageBox.y + (imageBox.height - imageHeight) / 2;

  for (let tick = 0; tick < snapshot.document.durationTicks; tick += 1) {
    throwIfAborted(options.signal);
    const rendered = await renderTickToCanvas(snapshot, tick, registry, repository, {
      intent: 'export', background: 'white', strictMissingRenderers: true, revision: options.revision, signal: options.signal,
    });
    const jpegBlob = await canvasBlob(rendered.canvas, 'image/jpeg', 0.94);
    pages.push({
      jpeg: new Uint8Array(await jpegBlob.arrayBuffer()), imageWidthPx: rendered.width, imageHeightPx: rendered.height,
      pageWidth, pageHeight, imageX, imageY, imageWidth, imageHeight,
      frameNumber: tick + 1, includePegBar: options.includeAcmePegBar,
    });
    options.onProgress?.((tick + 1) / snapshot.document.durationTicks, `Preparing printable page ${tick + 1} of ${snapshot.document.durationTicks}`);
  }
  return new Blob([buildPdfDocument(pages)], { type: 'application/pdf' });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`Could not encode ${type} image.`)), type, quality));
}

function buildPdfDocument(pages: readonly PdfPageInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  const offsets: number[] = [0];
  let position = parts[0].length;
  const addObject = (id: number, body: string | Uint8Array): void => {
    const prefix = encoder.encode(`${id} 0 obj\n`);
    const content = typeof body === 'string' ? encoder.encode(body) : body;
    const suffix = encoder.encode('\nendobj\n');
    offsets[id] = position;
    parts.push(prefix, content, suffix);
    position += prefix.length + content.length + suffix.length;
  };
  const addStream = (id: number, bytes: Uint8Array, dictionary: string): void => {
    const prefix = encoder.encode(`${id} 0 obj\n${dictionary}\nstream\n`);
    const suffix = encoder.encode('\nendstream\nendobj\n');
    offsets[id] = position;
    parts.push(prefix, bytes, suffix);
    position += prefix.length + bytes.length + suffix.length;
  };

  const pageIds = pages.map((_, index) => 4 + index * 3);
  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  addObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const content = buildPageContent(page);
    addObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.pageWidth.toFixed(2)} ${page.pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    addStream(contentId, content, `<< /Length ${content.length} >>`);
    addStream(imageId, page.jpeg, `<< /Type /XObject /Subtype /Image /Width ${page.imageWidthPx} /Height ${page.imageHeightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`);
  });

  const xrefOffset = position;
  const objectCount = 4 + pages.length * 3;
  const xref = ['xref', `0 ${objectCount}`, '0000000000 65535 f '];
  for (let id = 1; id < objectCount; id += 1) {
    xref.push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n `);
  }
  const trailer = encoder.encode(`${xref.join('\n')}\ntrailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  parts.push(trailer);
  return concat(parts);
}

function buildPageContent(page: PdfPageInput): Uint8Array {
  const left = 18, right = page.pageWidth - 18, top = page.pageHeight - 18, bottom = 18;
  const commands = [
    'q',
    `${page.imageWidth.toFixed(3)} 0 0 ${page.imageHeight.toFixed(3)} ${page.imageX.toFixed(3)} ${page.imageY.toFixed(3)} cm`,
    '/Im0 Do', 'Q',
    '0.5 w 0 0 0 RG',
    // Four registration crosshairs are outside the artwork area.
    `${(left - 6).toFixed(1)} ${top.toFixed(1)} m ${(left + 6).toFixed(1)} ${top.toFixed(1)} l S`,
    `${left.toFixed(1)} ${(top - 6).toFixed(1)} m ${left.toFixed(1)} ${(top + 6).toFixed(1)} l S`,
    `${(right - 6).toFixed(1)} ${top.toFixed(1)} m ${(right + 6).toFixed(1)} ${top.toFixed(1)} l S`,
    `${right.toFixed(1)} ${(top - 6).toFixed(1)} m ${right.toFixed(1)} ${(top + 6).toFixed(1)} l S`,
    `${(left - 6).toFixed(1)} ${bottom.toFixed(1)} m ${(left + 6).toFixed(1)} ${bottom.toFixed(1)} l S`,
    `${left.toFixed(1)} ${(bottom - 6).toFixed(1)} m ${left.toFixed(1)} ${(bottom + 6).toFixed(1)} l S`,
    `${(right - 6).toFixed(1)} ${bottom.toFixed(1)} m ${(right + 6).toFixed(1)} ${bottom.toFixed(1)} l S`,
    `${right.toFixed(1)} ${(bottom - 6).toFixed(1)} m ${right.toFixed(1)} ${(bottom + 6).toFixed(1)} l S`,
    `BT /F1 9 Tf 34 574 Td (${escapePdf(`FRAME ${String(page.frameNumber).padStart(4, '0')}`)}) Tj ET`,
  ];
  if (page.includePegBar) {
    for (let index = 0; index < 3; index += 1) {
      const y = page.pageHeight / 2 + (index - 1) * 20;
      commands.push(`0.7 w 18 ${y.toFixed(2)} 5 5 re S`);
    }
  }
  return new TextEncoder().encode(commands.join('\n'));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function escapePdf(value: string): string { return value.replace(/[\\()]/g, '\\$&'); }
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) { const error = new Error('Export cancelled.'); error.name = 'AbortError'; throw error; }
}
