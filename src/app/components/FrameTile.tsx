import React, { useEffect, useState } from 'react';
import type { ProjectDocumentV1 } from '../../core/document/types';
import type { RendererRegistry } from '../../core/rendering/renderer-registry';
import { renderTickToCanvas } from '../../core/rendering/render-service';
import type { ProjectRepository } from '../../core/storage/project-repository';

interface Props {
  project: ProjectDocumentV1;
  tick: number;
  selected: boolean;
  registry: RendererRegistry;
  repository: ProjectRepository;
  onClick: () => void;
}

export function FrameTile({ project, tick, selected, registry, repository, onClick }: Props): React.JSX.Element {
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const [tileRef, setTileRef] = useState<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!tileRef) return;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)), { root: document.getElementById('filmstrip'), rootMargin: '120px' });
    observer.observe(tileRef);
    return () => observer.disconnect();
  }, [tileRef]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void renderTickToCanvas(project, tick, registry, repository, { intent: 'thumbnail', width: 108, height: 61, background: 'document' })
      .then((result) => {
        if (cancelled) return;
        setPreviewUrl(result.canvas.toDataURL('image/jpeg', 0.72));
      })
      .catch(() => setPreviewUrl(undefined));
    return () => { cancelled = true; };
  }, [visible, project, tick, registry, repository]);
  const exposure = project.tracks[0]?.clips.find((clip) => clip.startTick <= tick && tick < clip.startTick + clip.durationTicks);
  const exposureLabel = exposure ? `CEL ${String(tick + 1).padStart(2, '0')}` : 'EMPTY';
  return <button ref={setTileRef} className={`frame-tile ${selected ? 'selected' : ''}`} onClick={onClick} aria-label={`Select frame ${tick + 1}`} aria-pressed={selected}>
    <span className="frame-preview">{previewUrl ? <img src={previewUrl} alt="" /> : <span className="preview-placeholder">{exposure ? '◌' : '—'}</span>}</span>
    <span className="frame-tile-meta"><strong>{String(tick + 1).padStart(2, '0')}</strong><small>{exposureLabel}</small></span>
    <span className="frame-selection-marker" />
  </button>;
}
