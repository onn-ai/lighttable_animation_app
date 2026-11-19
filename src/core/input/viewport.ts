export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
  flipHorizontal: boolean;
}
export interface ViewportSize { width: number; height: number }

/** Shared affine mapping for render and input conversion. */
export class ViewportTransform {
  constructor(
    readonly documentWidth: number,
    readonly documentHeight: number,
    private size: ViewportSize,
    private state: ViewportState,
  ) {}

  update(size: ViewportSize, state: ViewportState): void {
    this.size = size;
    this.state = state;
  }

  get scale(): number {
    const fit = Math.min(this.size.width / this.documentWidth, this.size.height / this.documentHeight) * 0.92;
    return Math.max(0.05, Math.min(8, fit * this.state.zoom));
  }

  get offsetX(): number { return this.size.width / 2 + this.state.panX; }
  get offsetY(): number { return this.size.height / 2 + this.state.panY; }
  get flipSign(): number { return this.state.flipHorizontal ? -1 : 1; }

  documentToViewport(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: this.offsetX + (point.x - this.documentWidth / 2) * this.scale * this.flipSign,
      y: this.offsetY + (point.y - this.documentHeight / 2) * this.scale,
    };
  }

  viewportToDocument(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: this.documentWidth / 2 + ((point.x - this.offsetX) / (this.scale * this.flipSign)),
      y: this.documentHeight / 2 + ((point.y - this.offsetY) / this.scale),
    };
  }

  applyToContext(ctx: CanvasRenderingContext2D, dpr: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale * this.flipSign, this.scale);
    ctx.translate(-this.documentWidth / 2, -this.documentHeight / 2);
  }

  fit(): ViewportState {
    return { zoom: 1, panX: 0, panY: 0, flipHorizontal: this.state.flipHorizontal };
  }
}

export function zoomAtPoint(state: ViewportState, point: { x: number; y: number }, factor: number, size: ViewportSize, documentSize: ViewportSize): ViewportState {
  const current = new ViewportTransform(documentSize.width, documentSize.height, size, state);
  const docPoint = current.viewportToDocument(point);
  const nextZoom = Math.max(0.2, Math.min(5, state.zoom * factor));
  const fit = Math.min(size.width / documentSize.width, size.height / documentSize.height) * 0.92;
  const nextScale = fit * nextZoom;
  const sign = state.flipHorizontal ? -1 : 1;
  const offsetX = point.x - (docPoint.x - documentSize.width / 2) * nextScale * sign;
  const offsetY = point.y - (docPoint.y - documentSize.height / 2) * nextScale;
  return { ...state, zoom: nextZoom, panX: offsetX - size.width / 2, panY: offsetY - size.height / 2 };
}
