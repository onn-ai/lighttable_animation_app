import type { CorePathData, CorePathSample } from '../document/types';

/** Deterministic variable-width path replay. Raw samples remain untouched. */
export function renderCorePath(context: CanvasRenderingContext2D, data: CorePathData): void {
  const { samples, paint } = data;
  if (!samples.length) return;
  const color = paint.color.length === 7 ? `${paint.color}FF` : paint.color;
  context.save();
  context.globalAlpha *= paint.opacity;
  context.globalCompositeOperation = paint.composite;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineCap = paint.cap;
  context.lineJoin = paint.join;
  context.imageSmoothingEnabled = true;
  if (samples.length === 1) {
    const point = samples[0];
    const radius = Math.max(0.1, paint.width * pressureScale(point.pressure) / 2);
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    context.beginPath();
    context.lineWidth = Math.max(0.1, paint.width * (pressureScale(a.pressure) + pressureScale(b.pressure)) / 2);
    context.moveTo(a.x, a.y);
    if (data.smoothing?.kind === 'quadratic' && i < samples.length - 1) {
      const next = samples[i + 1];
      context.quadraticCurveTo(b.x, b.y, (b.x + next.x) / 2, (b.y + next.y) / 2);
    } else {
      context.lineTo(b.x, b.y);
    }
    context.stroke();
  }
  // Round joins are filled explicitly to avoid hairline gaps at pressure changes.
  if (paint.cap === 'round' || paint.join === 'round') {
    for (const point of samples) {
      context.beginPath();
      context.arc(point.x, point.y, Math.max(0.1, paint.width * pressureScale(point.pressure) / 2), 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

export function pressureScale(pressure: number): number {
  const normalized = Math.max(0, Math.min(1, Number.isFinite(pressure) ? pressure : 0.5));
  return 0.18 + normalized * 0.82;
}

export function drawPreviewStroke(
  context: CanvasRenderingContext2D,
  samples: readonly CorePathSample[],
  paint: CorePathData['paint'],
  documentToCanvas: (context: CanvasRenderingContext2D) => void,
): void {
  if (!samples.length) return;
  context.save();
  documentToCanvas(context);
  renderCorePath(context, { samples: [...samples], paint, smoothing: { kind: 'quadratic' } });
  context.restore();
}
