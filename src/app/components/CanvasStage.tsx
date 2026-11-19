import React, { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { ProjectDocumentV1 } from '../../core/document/types';
import type { ViewportState, ViewportTransform } from '../../core/input/viewport';
import { ViewportTransform as Transform } from '../../core/input/viewport';
import type { RendererRegistry } from '../../core/rendering/renderer-registry';
import { renderEditorComposite, type OnionSettings } from '../../core/rendering/render-service';
import type { ProjectRepository } from '../../core/storage/project-repository';

interface Props {
  project: ProjectDocumentV1;
  tick: number;
  activeTrackId: string;
  registry: RendererRegistry;
  repository: ProjectRepository;
  onion: OnionSettings;
  revision: number;
  viewportState: ViewportState;
  viewportRef: React.MutableRefObject<ViewportTransform | null>;
  displayCanvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
}

export function CanvasStage({ project, tick, activeTrackId, registry, repository, onion, revision, viewportState, viewportRef, displayCanvasRef, overlayCanvasRef }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef({ width: 1, height: 1 });
  const drawRevisionRef = useRef(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      sizeRef.current = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      for (const canvas of [displayCanvasRef.current, overlayCanvasRef.current]) {
        if (!canvas) continue;
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      }
      const transform = viewportRef.current ?? new Transform(project.document.width, project.document.height, sizeRef.current, viewportState);
      transform.update(sizeRef.current, viewportState);
      viewportRef.current = transform;
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    window.addEventListener('resize', updateSize);
    updateSize();
    return () => { observer.disconnect(); window.removeEventListener('resize', updateSize); };
  }, [project.document.width, project.document.height, viewportState, displayCanvasRef, overlayCanvasRef, viewportRef]);

  useEffect(() => {
    const canvas = displayCanvasRef.current;
    const transform = viewportRef.current;
    if (!canvas || !transform) return;
    const drawVersion = ++drawRevisionRef.current;
    let cancelled = false;
    void renderEditorComposite(project, tick, activeTrackId, registry, repository, onion, revision)
      .then((result) => {
        if (cancelled || drawVersion !== drawRevisionRef.current) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        transform.applyToContext(context, dpr);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(result.canvas, 0, 0);
      })
      .catch((error) => {
        if (!cancelled && error instanceof Error && error.name !== 'AbortError') console.error('Canvas render failed.', error);
      });
    return () => { cancelled = true; };
  }, [project, tick, activeTrackId, registry, repository, onion, revision, viewportState, displayCanvasRef, viewportRef]);

  return <div className="stage-canvas-container" ref={containerRef}>
    <canvas className="stage-display-canvas" ref={displayCanvasRef} aria-label="Animation drawing canvas" />
    <canvas className="stage-input-canvas" ref={overlayCanvasRef} aria-label="Drawing input surface" />
    <div className="paper-corner-mark top-left" />
    <div className="paper-corner-mark top-right" />
    <div className="paper-corner-mark bottom-left" />
    <div className="paper-corner-mark bottom-right" />
  </div>;
}
