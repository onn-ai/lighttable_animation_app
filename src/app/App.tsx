import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ComponentType, ReactNode } from 'react';
import type { LightTablePlugin, PluginPanelProps, ToolContext } from '../../contracts/plugin-api';
import {
  addLayer, deleteFrame, duplicateFrame, getActiveTarget, insertBlankFrame, removeLayer, updateLayer,
} from '../core/document/operations';
import {
  cloneValue, createDefaultProject, MAX_USER_FRAME_COUNT, newId, type CorePathSample, type ProjectDocumentV1,
} from '../core/document/types';
import { validateProject } from '../core/document/validate';
import { TransactionEngine } from '../core/history/transaction-engine';
import { InputService, type InputSample } from '../core/input/input-service';
import { ViewportTransform, type ViewportState, zoomAtPoint } from '../core/input/viewport';
import { RendererRegistry } from '../core/rendering/renderer-registry';
import { renderCorePath } from '../core/rendering/path-renderer';
import { type OnionSettings } from '../core/rendering/render-service';
import { ProjectRepository, AutosaveController } from '../core/storage/project-repository';
import { exportProjectPackage, importProjectPackage } from '../core/export/project-package';
import { exportA4PDF, exportPNGSequence } from '../core/export/print-export';
import { PluginRuntime, EventBus, type HostRegistries, type PluginHostContext } from '../core/plugins/sdk-host';
import { CanvasStage } from './components/CanvasStage';
import { FrameTile } from './components/FrameTile';

const PRODUCT_NAME = 'LightTable';
const PLUGIN_ID = 'com.lighttable.coloring';
const DEFAULT_ONION: OnionSettings = { enabled: true, before: 1, after: 1, beforeOpacity: 0.27, afterOpacity: 0.27 };
type CoreTool = 'pencil' | 'eraser';
type SaveState = 'saved' | 'saving' | 'error';
interface ActiveStroke {
  target: { celId: string; layerId: string };
  samples: CorePathSample[];
  tool: CoreTool;
  startTimeStamp: number;
}
interface ModalState { type: 'projects' | 'settings' | 'export' | 'shortcuts' | null }
interface ToastState { message: string; tone?: 'normal' | 'error' }

function createRegistries(onChange: () => void): HostRegistries {
  return {
    tools: new Map(), modes: new Map(), panels: new Map(), toolbar: new Map(), menus: new Map(),
    commands: new Map(), overlays: new Map(), importers: new Map(), exporters: new Map(), settings: new Map(), onChange,
  };
}

export default function App(): React.JSX.Element {
  const [engine] = useState(() => new TransactionEngine(createDefaultProject()));
  const [repository] = useState(() => new ProjectRepository());
  const [renderers] = useState(() => {
    const registry = new RendererRegistry();
    registry.registerCorePath();
    return registry;
  });
  const [events] = useState(() => new EventBus());
  const [registryVersion, setRegistryVersion] = useState(0);
  const registries = useMemo(() => createRegistries(() => setRegistryVersion((value) => value + 1)), []);
  const [revision, setRevision] = useState(engine.revision);
  const [project, setProject] = useState(engine.document);
  const [currentTick, setCurrentTick] = useState(0);
  const [activeTrackId, setActiveTrackId] = useState(engine.document.tracks[0].id);
  const [activeLayerId, setActiveLayerId] = useState(engine.document.cels[engine.document.tracks[0].clips[0].celId].layers[0].id);
  const [activeTool, setActiveTool] = useState<string>('pencil');
  const [inkColor, setInkColor] = useState('#1A1A1A');
  const [brushSize, setBrushSize] = useState(5);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [onion, setOnion] = useState<OnionSettings>(DEFAULT_ONION);
  const [viewportState, setViewportState] = useState<ViewportState>({ zoom: 1, panX: 0, panY: 0, flipHorizontal: false });
  const [playing, setPlaying] = useState(false);
  const [loopPlayback, setLoopPlayback] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveMessage, setSaveMessage] = useState('All changes saved');
  const [modal, setModal] = useState<ModalState>({ type: null });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pluginEnabled, setPluginEnabled] = useState(false);
  const [pluginBusy, setPluginBusy] = useState(false);
  const [projectList, setProjectList] = useState<Array<{ projectId: string; name: string; updatedAt: string; durationTicks: number }>>([]);
  const [exportProgress, setExportProgress] = useState<{ label: string; fraction: number } | null>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [showTimeline, setShowTimeline] = useState(true);

  const tickRef = useRef(currentTick);
  const trackRef = useRef(activeTrackId);
  const layerRef = useRef(activeLayerId);
  const toolRef = useRef(activeTool);
  const projectRef = useRef(project);
  const playingRef = useRef(playing);
  const strokeRef = useRef<ActiveStroke | null>(null);
  const inputServiceRef = useRef(new InputService());
  const viewportRef = useRef<ViewportTransform | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playbackFrameRef = useRef<number | undefined>(undefined);
  const lastPlaybackTimeRef = useRef(0);
  const autosaveRef = useRef<AutosaveController | null>(null);
  const persistentStorageRef = useRef(true);
  const pluginRuntimeRef = useRef<PluginRuntime | null>(null);
  const [redrawToken, setRedrawToken] = useState(0);
  const [storageReady, setStorageReady] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => { tickRef.current = currentTick; }, [currentTick]);
  useEffect(() => { trackRef.current = activeTrackId; }, [activeTrackId]);
  useEffect(() => { layerRef.current = activeLayerId; }, [activeLayerId]);
  useEffect(() => { toolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const showToast = useCallback((message: string, tone: 'normal' | 'error' = 'normal') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast((current) => current?.message === message ? null : current), 3400);
  }, []);

  const hostContext: PluginHostContext = useMemo(() => ({
    engine, repository, renderers, registries,
    getCurrentTick: () => tickRef.current,
    setCurrentTick: (tick) => setCurrentTick(Math.max(0, Math.min(engine.document.document.durationTicks - 1, tick))),
    getActiveTarget: () => {
      const target = getActiveTarget(engine.document, tickRef.current, trackRef.current, layerRef.current);
      return target ? { tick: target.tick, trackId: target.trackId, clipId: target.clipId, celId: target.celId, layerId: target.layerId } : undefined;
    },
    invalidate: () => setRedrawToken((value) => value + 1),
  }), [engine, repository, renderers, registries]);
  const loadPluginRuntime = useCallback(async (): Promise<PluginRuntime> => {
    if (pluginRuntimeRef.current) return pluginRuntimeRef.current;
    // The optional plugin entry is evaluated only after the user explicitly enables it.
    const module = await import('../../plugins/coloring-mode/dist/index.js');
    const runtime = new PluginRuntime(module.default as LightTablePlugin, hostContext, events);
    pluginRuntimeRef.current = runtime;
    return runtime;
  }, [hostContext, events]);

  useEffect(() => () => {
    inputServiceRef.current.detach();
    const runtime = pluginRuntimeRef.current;
    if (runtime?.isActive) void runtime.disable('shutdown');
  }, []);

  useEffect(() => {
    const unsubscribe = engine.subscribe((document, nextRevision, label) => {
      setProject(document);
      projectRef.current = document;
      setRevision(nextRevision);
      setCurrentTick((tick) => Math.min(tick, document.document.durationTicks - 1));
      events.emit('document.changed', { projectId: document.projectId, revision: nextRevision, affectedIds: [] });
      events.emit('document.revisionChanged', { revision: nextRevision });
      if (label.startsWith('Undo') || label.startsWith('Redo')) showToast(label);
    });
    return unsubscribe;
  }, [engine, events, showToast]);

  useEffect(() => {
    const autosave = new AutosaveController(repository, (status, message) => {
      if (status === 'saved' && !persistentStorageRef.current) {
        setSaveState('error');
        setSaveMessage('Session-only storage: changes will not survive closing this browser.');
        return;
      }
      setSaveState(status);
      setSaveMessage(message ?? (status === 'saved' ? 'All changes saved locally' : status === 'saving' ? 'Saving locally…' : 'Could not save locally'));
    }, 700);
    autosaveRef.current = autosave;
    const unsubscribe = engine.subscribe((document, nextRevision) => autosave.schedule(document, nextRevision));
    void (async () => {
      try {
        persistentStorageRef.current = await repository.hasPersistentStorage();
        if (!persistentStorageRef.current) showToast('Browser storage is unavailable. This session can run, but projects will not survive closing the browser.', 'error');
        const lastProjectId = localStorage.getItem('lighttable:last-project');
        const stored = lastProjectId ? await repository.loadProject(lastProjectId) : undefined;
        if (stored) {
          validateProject(stored.document);
          await repository.warmAssetDescriptors(stored.document.assets);
          engine.replace(stored.document, 'Restore local project');
          setProject(stored.document);
          setRevision(engine.revision);
          setActiveTrackId(stored.document.tracks[0].id);
          const firstCel = stored.document.cels[stored.document.tracks[0].clips[0]?.celId];
          setActiveLayerId(firstCel?.layers[0]?.id ?? '');
        } else {
          autosave.schedule(engine.document, engine.revision);
          localStorage.setItem('lighttable:last-project', engine.document.projectId);
        }
      } catch (error) {
        showToast(`Local recovery could not be loaded: ${error instanceof Error ? error.message : String(error)}`, 'error');
      } finally { setStorageReady(true); }
    })();
    const flushLatest = () => { void autosave.flush(engine.document, engine.revision); };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flushLatest(); };
    window.addEventListener('beforeunload', flushLatest);
    window.addEventListener('pagehide', flushLatest);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { unsubscribe(); autosave.dispose(); window.removeEventListener('beforeunload', flushLatest); window.removeEventListener('pagehide', flushLatest); document.removeEventListener('visibilitychange', onVisibilityChange); autosaveRef.current = null; };
  }, [engine, repository, showToast]);

  const refreshProjects = useCallback(async () => setProjectList(await repository.listProjects()), [repository]);
  useEffect(() => { void refreshProjects(); }, [refreshProjects, revision]);

  const activeClip = useMemo(() => {
    const track = project.tracks.find((item) => item.id === activeTrackId);
    return track?.clips.find((clip) => clip.startTick <= currentTick && currentTick < clip.startTick + clip.durationTicks);
  }, [project, activeTrackId, currentTick]);
  const activeCel = activeClip ? project.cels[activeClip.celId] : undefined;
  const activeLayer = activeCel?.layers.find((layer) => layer.id === activeLayerId) ?? activeCel?.layers[0];
  useEffect(() => {
    if (!activeCel) return;
    if (!activeCel.layers.some((layer) => layer.id === activeLayerId)) setActiveLayerId(activeCel.layers[0]?.id ?? '');
  }, [activeCel, activeLayerId]);
  const frameRate = project.document.frameRate.numerator / project.document.frameRate.denominator;
  const playbackFps = frameRate;
  const setPlaybackFps = (fps: number) => engine.transact('Set frame rate', (draft) => { draft.document.frameRate = { numerator: fps, denominator: 1 }; });
  const timelineFrameCount = Math.min(project.document.durationTicks, MAX_USER_FRAME_COUNT);
  const timelineEditsSupported = project.document.durationTicks <= MAX_USER_FRAME_COUNT;

  const toolContext = useCallback((): ToolContext | undefined => {
    const api = pluginRuntimeRef.current?.registeredApi;
    if (!api) return undefined;
    let finished = false;
    return {
      pluginId: PLUGIN_ID,
      document: api.document,
      frames: api.frames,
      getActiveTarget: () => hostContext.getActiveTarget(),
      beginGesture() {
        const id = newId('gesture');
        return {
          id,
          updatePreview: () => hostContext.invalidate(),
          commit(options, build) {
            if (finished) return { committed: false, revision: engine.revision, conflict: { expected: options.expectedRevision ?? engine.revision, actual: engine.revision } };
            const result = api.document.transact(options, build);
            if (result.committed) finished = true;
            return result;
          },
          cancel: () => { finished = true; },
        };
      },
      invalidate: () => hostContext.invalidate(),
      reportProgress: (progress) => showToast(progress.message ?? `${Math.round(progress.fraction * 100)}%`),
    };
  }, [hostContext, engine, showToast]);

  const resetOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const paintStrokePreview = useCallback((samples: CorePathSample[], tool: CoreTool) => {
    const canvas = overlayCanvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = window.devicePixelRatio || 1;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    viewport.applyToContext(context, dpr);
    if (tool === 'eraser') {
      const sample = samples[samples.length - 1];
      const scale = viewport.scale;
      context.save();
      context.beginPath();
      context.arc(sample.x, sample.y, Math.max(9, brushSize / 2) / scale, 0, Math.PI * 2);
      context.fillStyle = 'rgba(255,255,255,.32)';
      context.fill();
      context.strokeStyle = '#888888';
      context.lineWidth = 1 / scale;
      context.stroke();
      context.restore();
      return;
    }
    renderCorePath(context, {
      samples,
      paint: { color: inkColor, width: brushSize, opacity: brushOpacity, cap: 'round', join: 'round', composite: 'source-over' },
      smoothing: { kind: 'quadratic', amount: 0.15 },
    });
  }, [brushSize, inkColor]);

  const sampleAsSdk = (sample: InputSample) => ({ ...sample, modifiers: { ...sample.modifiers } });
  useEffect(() => {
    const target = overlayCanvasRef.current;
    if (!target || !storageReady) return;
    const service = inputServiceRef.current;
    const unregister = service.attach(target, {
      onDown(sample) {
        if (playingRef.current) return;
        const selectedTool = toolRef.current;
        const pluginTool = registries.tools.get(`${PLUGIN_ID}:${selectedTool}`);
        if (pluginTool) {
          const context = toolContext();
          pluginTool.onPointerDown?.(sampleAsSdk(sample), context!);
          return;
        }
        if (selectedTool !== 'pencil' && selectedTool !== 'eraser') return;
        const targetInfo = getActiveTarget(engine.document, tickRef.current, trackRef.current, layerRef.current);
        if (!targetInfo) { showToast('There is no editable drawing on this frame.', 'error'); return; }
        if (targetInfo.layerLocked || engine.document.tracks.find((track) => track.id === trackRef.current)?.locked) {
          showToast('Unlock the selected layer or track before drawing.', 'error'); return;
        }
        strokeRef.current = {
          target: { celId: targetInfo.celId, layerId: targetInfo.layerId },
          samples: [{ x: sample.document.x, y: sample.document.y, pressure: sample.pressure, timeOffsetMs: 0, tiltX: sample.tiltX, tiltY: sample.tiltY, twist: sample.twist }],
          tool: selectedTool,
          startTimeStamp: sample.timeStamp,
        };
        paintStrokePreview(strokeRef.current.samples, selectedTool);
      },
      onMove(samples) {
        const selectedTool = toolRef.current;
        const pluginTool = registries.tools.get(`${PLUGIN_ID}:${selectedTool}`);
        if (pluginTool) {
          const context = toolContext();
          for (const item of samples) pluginTool.onPointerMove?.(sampleAsSdk(item), context!);
          return;
        }
        const activeStroke = strokeRef.current;
        if (!activeStroke) return;
        for (const item of samples) activeStroke.samples.push({ x: item.document.x, y: item.document.y, pressure: item.pressure, timeOffsetMs: Math.max(0, item.timeStamp - activeStroke.startTimeStamp), tiltX: item.tiltX, tiltY: item.tiltY, twist: item.twist });
        paintStrokePreview(activeStroke.samples, activeStroke.tool);
      },
      onUp(sample) {
        const selectedTool = toolRef.current;
        const pluginTool = registries.tools.get(`${PLUGIN_ID}:${selectedTool}`);
        if (pluginTool) {
          const context = toolContext();
          pluginTool.onPointerUp?.(sampleAsSdk(sample), context!);
          return;
        }
        const activeStroke = strokeRef.current;
        strokeRef.current = null;
        resetOverlay();
        if (!activeStroke) return;
        activeStroke.samples.push({ x: sample.document.x, y: sample.document.y, pressure: sample.pressure, timeOffsetMs: Math.max(0, sample.timeStamp - activeStroke.startTimeStamp), tiltX: sample.tiltX, tiltY: sample.tiltY, twist: sample.twist });
        const node = {
          id: newId('node'), type: 'core.path', typeVersion: 1, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number], visible: true,
          data: {
            samples: activeStroke.samples,
            paint: {
              color: activeStroke.tool === 'eraser' ? '#000000' : inkColor,
              width: activeStroke.tool === 'eraser' ? brushSize * 2.4 : brushSize,
              opacity: activeStroke.tool === 'eraser' ? 1 : brushOpacity,
              cap: 'round' as const, join: 'round' as const,
              composite: activeStroke.tool === 'eraser' ? 'destination-out' as const : 'source-over' as const,
            },
            smoothing: { kind: 'quadratic' as const, amount: 0.15 },
          },
        };
        try {
          engine.transact(activeStroke.tool === 'eraser' ? 'Erase stroke' : 'Pencil stroke', (draft) => {
            const layer = draft.cels[activeStroke.target.celId]?.layers.find((item) => item.id === activeStroke.target.layerId);
            if (!layer || layer.locked) throw new Error('The drawing target changed or became locked before the stroke committed.');
            layer.nodes.push(cloneValue(node) as unknown as import('../core/document/types').ContentNode);
          });
        } catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error'); }
      },
      onCancel(reason) {
        strokeRef.current = null;
        resetOverlay();
        const pluginTool = registries.tools.get(`${PLUGIN_ID}:${toolRef.current}`);
        pluginTool?.onCancel?.(reason, toolContext()!);
      },
    }, {
      touchPolicy: 'draw', mousePressure: 0.5,
      screenToDocument: (point) => viewportRef.current?.viewportToDocument(point) ?? point,
    });
    return () => { unregister(); service.detach(target); };
  }, [engine, storageReady, registries, toolContext, showToast, paintStrokePreview, resetOverlay, inkColor, brushSize, brushOpacity]);

  const renderVersion = revision + redrawToken + registryVersion;
  const togglePlayback = useCallback(() => setPlaying((current) => !current), []);
  useEffect(() => {
    if (!playing) {
      if (playbackFrameRef.current !== undefined) cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = undefined;
      events.emit('playback.stopped', { tick: tickRef.current });
      return;
    }
    events.emit('playback.started', { tick: tickRef.current });
    lastPlaybackTimeRef.current = performance.now();
    const tickDuration = 1000 / playbackFps;
    const step = (time: number) => {
      if (time - lastPlaybackTimeRef.current >= tickDuration) {
        const elapsedFrames = Math.max(1, Math.floor((time - lastPlaybackTimeRef.current) / tickDuration));
        lastPlaybackTimeRef.current += elapsedFrames * tickDuration;
        const duration = projectRef.current.document.durationTicks;
        const rawNext = tickRef.current + elapsedFrames;
        const reachedEnd = rawNext >= duration;
        const nextTick = reachedEnd ? (loopPlayback ? rawNext % duration : duration - 1) : rawNext;
        tickRef.current = nextTick;
        setCurrentTick(nextTick);
        events.emit('playhead.changed', { tick: nextTick });
        events.emit('playback.tick', { tick: nextTick });
        if (reachedEnd && !loopPlayback) setPlaying(false);
      }
      playbackFrameRef.current = requestAnimationFrame(step);
    };
    playbackFrameRef.current = requestAnimationFrame(step);
    return () => { if (playbackFrameRef.current !== undefined) cancelAnimationFrame(playbackFrameRef.current); };
  }, [playing, playbackFps, loopPlayback, events, project.document.durationTicks]);

  const chooseTool = useCallback((toolId: string) => {
    if (toolRef.current === toolId) return;
    const previousPluginTool = registries.tools.get(`${PLUGIN_ID}:${toolRef.current}`);
    inputServiceRef.current.cancel('tool-change');
    if (previousPluginTool) previousPluginTool.onDeactivate?.(toolContext()!);
    strokeRef.current = null;
    resetOverlay();
    setActiveTool(toolId);
    const nextPluginTool = registries.tools.get(`${PLUGIN_ID}:${toolId}`);
    if (nextPluginTool) nextPluginTool.onActivate?.(toolContext()!);
  }, [registries, toolContext, resetOverlay]);

  const updateLayerField = useCallback((layerId: string, patch: Parameters<typeof updateLayer>[3]) => {
    if (!activeCel) return;
    try { updateLayer(engine, activeCel.id, layerId, patch); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error'); }
  }, [engine, activeCel, showToast]);

  const activatePlugin = useCallback(async (enabled: boolean) => {
    setPluginBusy(true);
    try {
      if (enabled) {
        const runtime = await loadPluginRuntime();
        await runtime.enable();
        setPluginEnabled(true);
        showToast('Coloring Mode is enabled.');
      } else {
        await pluginRuntimeRef.current?.disable('disable');
        setPluginEnabled(false);
        if (activeTool.startsWith('paint-') || activeTool === 'color-picker') chooseTool('pencil');
        showToast('Coloring Mode is disabled; its project data has been preserved.');
      }
    } catch (error) {
      showToast(`Coloring Mode could not be ${enabled ? 'enabled' : 'disabled'}: ${error instanceof Error ? error.message : String(error)}`, 'error');
      setPluginEnabled(pluginRuntimeRef.current?.isActive ?? false);
    } finally { setPluginBusy(false); }
  }, [loadPluginRuntime, showToast, activeTool, chooseTool]);

  const chooseFrame = useCallback((tick: number) => {
    inputServiceRef.current.cancel('tool-change');
    const resolvedTick = Math.max(0, Math.min(engine.document.document.durationTicks - 1, tick));
    tickRef.current = resolvedTick;
    setCurrentTick(resolvedTick);
    events.emit('playhead.changed', { tick: resolvedTick });
  }, [events, engine]);

  const addBlank = () => {
    inputServiceRef.current.cancel('tool-change');
    try { const tick = insertBlankFrame(engine, activeTrackId, currentTick); chooseFrame(tick); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error'); }
  };
  const duplicate = () => {
    inputServiceRef.current.cancel('tool-change');
    try { const tick = duplicateFrame(engine, activeTrackId, currentTick); chooseFrame(tick); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error'); }
  };
  const remove = () => {
    inputServiceRef.current.cancel('tool-change');
    try { const tick = deleteFrame(engine, activeTrackId, currentTick); chooseFrame(tick); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error'); }
  };

  const createNewProject = useCallback(() => {
    const next = createDefaultProject('Untitled Animation');
    engine.replace(next, 'New project');
    setCurrentTick(0);
    setActiveTrackId(next.tracks[0].id);
    setActiveLayerId(next.cels[next.tracks[0].clips[0].celId].layers[0].id);
    localStorage.setItem('lighttable:last-project', next.projectId);
    setModal({ type: null });
    showToast('New animation created.');
  }, [engine, showToast]);

  const openProject = useCallback(async (projectId: string) => {
    const record = await repository.loadProject(projectId);
    if (!record) { showToast('That saved project is no longer available.', 'error'); return; }
    try {
      validateProject(record.document);
      await repository.warmAssetDescriptors(record.document.assets);
      engine.replace(record.document, 'Open project');
      setCurrentTick(0);
      setActiveTrackId(record.document.tracks[0].id);
      setActiveLayerId(record.document.cels[record.document.tracks[0].clips[0].celId]?.layers[0]?.id ?? '');
      localStorage.setItem('lighttable:last-project', projectId);
      setModal({ type: null });
      events.emit('project.opened', { projectId });
    } catch (error) { showToast(`Project could not be opened: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
  }, [repository, engine, showToast, events]);

  const importProject = useCallback(async (file: File) => {
    try {
      const imported = await importProjectPackage(file, repository);
      await repository.warmAssetDescriptors(imported.assets);
      engine.replace(imported, 'Import project');
      setCurrentTick(0);
      setActiveTrackId(imported.tracks[0].id);
      setActiveLayerId(imported.cels[imported.tracks[0].clips[0].celId]?.layers[0]?.id ?? '');
      localStorage.setItem('lighttable:last-project', imported.projectId);
      setModal({ type: null });
      showToast('Project imported successfully.');
    } catch (error) { showToast(`Project import failed: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
  }, [repository, engine, showToast]);

  const exportProject = useCallback(async () => {
    try {
      const snapshot = engine.document;
      const packageBlob = await exportProjectPackage(snapshot, repository);
      downloadBlob(packageBlob, `${slugify(snapshot.name)}.ltproj`);
      showToast('Project package exported.');
    } catch (error) { showToast(`Project export failed: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
  }, [engine, repository, showToast]);

  const runExport = useCallback(async (kind: 'png' | 'pdf') => {
    setExportBusy(true);
    setExportProgress({ label: 'Preparing export…', fraction: 0 });
    try {
      const snapshot = engine.document; // Clone is revision-pinned for the full export.
      const snapshotRevision = engine.revision;
      const onProgress = (fraction: number, label: string) => setExportProgress({ fraction, label });
      const blob = kind === 'png'
        ? await exportPNGSequence(snapshot, renderers, repository, { transparent: false, revision: snapshotRevision, onProgress })
        : await exportA4PDF(snapshot, renderers, repository, { includeAcmePegBar: true, revision: snapshotRevision, onProgress });
      if (snapshotRevision !== engine.revision) showToast('Export used the saved snapshot from the start of the operation.');
      downloadBlob(blob, `${slugify(snapshot.name)}_${kind === 'png' ? 'frames.zip' : 'A4-landscape.pdf'}`);
      showToast(kind === 'png' ? 'PNG frame sequence exported.' : 'A4 landscape PDF exported.');
    } catch (error) { showToast(`Export failed: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
    finally { setExportBusy(false); setExportProgress(null); }
  }, [engine, renderers, repository, showToast]);

  const saveNow = useCallback(async () => {
    const saved = await autosaveRef.current?.flush(engine.document, engine.revision);
    if (!saved) showToast('The project could not be saved. Check browser storage availability.', 'error');
    else if (!persistentStorageRef.current) showToast('Saved in temporary session memory only; export a .ltproj backup before closing.', 'error');
    else showToast('Project saved locally.');
  }, [engine, showToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) engine.redo(); else engine.undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'y') { event.preventDefault(); engine.redo(); return; }
      if (key === ' ') { event.preventDefault(); togglePlayback(); return; }
      if (key === 'arrowleft') { event.preventDefault(); chooseFrame(currentTick - 1); return; }
      if (key === 'arrowright') { event.preventDefault(); chooseFrame(currentTick + 1); return; }
      if (key === 'b') chooseTool('pencil');
      if (key === 'e') chooseTool('eraser');
      if (key === 'h') setOnion((value) => ({ ...value, enabled: !value.enabled }));
      if (key === 'f') setViewportState((value) => ({ ...value, flipHorizontal: !value.flipHorizontal }));
      if (event.shiftKey && key === 'd' && pluginEnabled) void registries.commands.get(`${PLUGIN_ID}:toggle-draft`)?.execute();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine, currentTick, togglePlayback, chooseFrame, chooseTool, pluginEnabled, registries]);

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setViewportState((state) => zoomAtPoint(state, point, event.deltaY < 0 ? 1.12 : 0.89, { width: rect.width, height: rect.height }, { width: project.document.width, height: project.document.height }));
    }
  }, [project.document.width, project.document.height]);

  const handleImportInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void importProject(file);
    event.target.value = '';
  };

  const activePluginPanels = [...registries.panels.entries()].filter(([key]) => key.startsWith(`${PLUGIN_ID}:`));
  const activePluginTools = [...registries.tools.entries()].filter(([key]) => key.startsWith(`${PLUGIN_ID}:`));
  const activePluginToolbar = [...registries.toolbar.entries()].filter(([key, item]) => key.startsWith(`${PLUGIN_ID}:`) && item.slot === 'toolbar.top');
  const panelProps = (panelId: string): PluginPanelProps => ({ pluginId: PLUGIN_ID, panelId, document: pluginRuntimeRef.current!.registeredApi!.document, frames: pluginRuntimeRef.current!.registeredApi!.frames, close: () => setShowLayers(false) });

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark">L</div><div><div className="brand-name">LightTable</div><div className="brand-subtitle">ROUGH ANIMATION STUDIO</div></div></div>
      <div className="topbar-center">
        <button className="project-name-button" onClick={() => { void refreshProjects(); setModal({ type: 'projects' }); }} title="Open project gallery"><span className="project-dot" />{project.name}<span className="chevron">⌄</span></button>
        <span className={`save-indicator ${saveState}`} title={saveMessage}><span />{saveState === 'saving' ? 'Saving' : saveState === 'error' ? 'Save issue' : 'Saved'}</span>
      </div>
      <div className="topbar-actions">
        <button className="icon-button" onClick={() => void saveNow()} title="Save locally">↧</button>
        <button className="icon-button" onClick={() => setViewportState((state) => ({ ...state, flipHorizontal: !state.flipHorizontal }))} title="Flip canvas horizontally (F)">⇋</button>
        <button className={`icon-button ${onion.enabled ? 'selected' : ''}`} onClick={() => setOnion((state) => ({ ...state, enabled: !state.enabled }))} title="Toggle onion skin (H)">◉</button>
        <button className="icon-button" onClick={() => setModal({ type: 'shortcuts' })} title="Keyboard shortcuts">⌘</button>
        {activePluginToolbar.map(([key, item]) => <button key={key} className="plugin-toolbar-button" title={item.tooltip ?? item.name} onClick={() => { if (item.onClick) item.onClick(); else if (item.commandId) void registries.commands.get(`${PLUGIN_ID}:${item.commandId}`)?.execute(); }}><span>{item.icon === 'eye-off' ? '◉' : '✦'}</span>{item.name}</button>)}
        <button className="primary-top-button" onClick={() => setModal({ type: 'export' })}>Export <span>↗</span></button>
      </div>
    </header>

    <main className="workspace">
      <aside className="tool-rail">
        <div className="tool-group-label">DRAW</div>
        <ToolButton active={activeTool === 'pencil'} label="Pencil" shortcut="B" onClick={() => chooseTool('pencil')}>✎</ToolButton>
        <ToolButton active={activeTool === 'eraser'} label="Eraser" shortcut="E" onClick={() => chooseTool('eraser')}>▱</ToolButton>
        {activePluginTools.length > 0 && <><div className="rail-divider" /><div className="tool-group-label">COLORING</div>{activePluginTools.map(([key, tool]) => <ToolButton key={key} active={activeTool === tool.id} label={tool.name} shortcut={tool.shortcut} onClick={() => chooseTool(tool.id)}>{tool.id === 'paint-bucket' ? '▧' : tool.id === 'color-picker' ? '◉' : tool.icon ?? '✦'}</ToolButton>)}</>}
        <div className="rail-divider" />
        <div className="tool-group-label">INK</div>
        <button className={`swatch-button ${inkColor === '#1A1A1A' ? 'active' : ''}`} style={{ '--swatch': '#1A1A1A' } as React.CSSProperties} onClick={() => setInkColor('#1A1A1A')} title="Graphite"> </button>
        <button className={`swatch-button ${inkColor === '#2563EB' ? 'active' : ''}`} style={{ '--swatch': '#2563EB' } as React.CSSProperties} onClick={() => setInkColor('#2563EB')} title="Non-photo blue"> </button>
        <div className="rail-divider" />
        <ToolButton active={onion.enabled} label="Onion skin" shortcut="H" onClick={() => setOnion((value) => ({ ...value, enabled: !value.enabled }))}>◉</ToolButton>
        <div className="rail-spacer" />
        <ToolButton active={showLayers} label="Layers" onClick={() => setShowLayers((value) => !value)}>▤</ToolButton>
        <ToolButton active={modal.type === 'settings'} label="Settings" onClick={() => setModal({ type: 'settings' })}>⚙</ToolButton>
      </aside>

      <section className="canvas-column">
        <div className="canvas-toolbar">
          <div className="toolbar-section"><span className="context-label">FRAME</span><span className="frame-counter">{String(currentTick + 1).padStart(2, '0')} <span>/ {String(project.document.durationTicks).padStart(2, '0')}</span></span><span className="toolbar-divider" /><span className="context-label">{project.document.width} × {project.document.height}</span></div>
          <div className="toolbar-section"><button className="tiny-tool" onClick={() => setViewportState((value) => ({ ...value, zoom: Math.max(.2, value.zoom / 1.2) }))}>−</button><span className="zoom-readout">{Math.round(viewportState.zoom * 100)}%</span><button className="tiny-tool" onClick={() => setViewportState((value) => ({ ...value, zoom: Math.min(5, value.zoom * 1.2) }))}>+</button><button className="tiny-text-button" onClick={() => setViewportState((value) => ({ ...value, zoom: 1, panX: 0, panY: 0 }))}>FIT</button></div>
        </div>
        <div className="stage-area" onWheel={onWheel}>
          <CanvasStage
            project={project}
            tick={currentTick}
            activeTrackId={activeTrackId}
            registry={renderers}
            repository={repository}
            onion={onion}
            revision={renderVersion}
            viewportState={viewportState}
            viewportRef={viewportRef}
            displayCanvasRef={displayCanvasRef}
            overlayCanvasRef={overlayCanvasRef}
          />
          <div className="stage-hud stage-hud-left"><span className="hud-dot" />{activeTool === 'pencil' ? 'PENCIL' : activeTool === 'eraser' ? 'ERASER' : activeTool.toUpperCase()}</div>
          <div className="stage-hud stage-hud-right"><span className="keycap">{viewportState.flipHorizontal ? 'FLIPPED' : 'NORMAL'}</span></div>
          <div className="stage-footer-note">{project.document.background.kind === 'solid' ? 'PAPER' : 'TRANSPARENT'} <span>·</span> 2D FRAME WORKSPACE</div>
        </div>
        <div className="brush-dock">
          <div className="brush-control brush-size-control"><span className="control-label">SIZE</span><strong>{brushSize.toFixed(1)} px</strong><input type="range" min="1" max="36" step="0.5" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></div>
          <div className="dock-separator" />
          <div className="brush-control"><span className="control-label">OPACITY</span><strong>{Math.round(brushOpacity * 100)}%</strong><input type="range" min="0.05" max="1" step="0.05" value={brushOpacity} onChange={(event) => setBrushOpacity(Number(event.target.value))} /></div>
          <div className="dock-separator" />
          <div className="color-control"><span className="control-label">ACTIVE INK</span><div className="active-color"><span style={{ background: inkColor }} />{inkColor === '#2563EB' ? 'Non-photo blue' : 'Graphite'}</div></div>
        </div>
      </section>

      {showLayers && <aside className="right-dock">
        <div className="dock-heading"><div><span className="eyebrow">DRAWING STACK</span><h2>Layers</h2></div><button className="icon-button subtle" onClick={() => setShowLayers(false)}>×</button></div>
        <div className="layer-context"><span className="layer-context-dot" />{activeCel ? `Frame ${currentTick + 1} · ${activeCel.layers.length}/4 layers` : 'No exposure'}</div>
        <div className="layer-list">
          {(activeCel?.layers ?? []).slice().reverse().map((layer) => <div key={layer.id} className={`layer-row ${layer.id === activeLayerId ? 'active' : ''}`}>
            <button className="layer-main" onClick={() => setActiveLayerId(layer.id)}><span className="layer-thumbnail">▧</span><span className="layer-name-block"><strong>{layer.name}</strong><small>{layer.nodes.length} objects</small></span></button>
            <button className={`layer-mini-action ${layer.visible ? 'on' : ''}`} onClick={() => updateLayerField(layer.id, { visible: !layer.visible })} title={layer.visible ? 'Hide layer' : 'Show layer'}>{layer.visible ? '◉' : '○'}</button>
            <button className={`layer-mini-action ${layer.locked ? 'on' : ''}`} onClick={() => updateLayerField(layer.id, { locked: !layer.locked })} title={layer.locked ? 'Unlock layer' : 'Lock layer'}>{layer.locked ? '▣' : '□'}</button>
          </div>)}
          {!activeCel && <div className="empty-layers">No cel on this frame</div>}
        </div>
        <div className="layer-properties">
          <div className="property-heading">LAYER PROPERTIES</div>
          {activeLayer ? <><div className="property-line"><span>Opacity</span><strong>{Math.round(activeLayer.opacity * 100)}%</strong></div><input type="range" min="0" max="1" step="0.05" value={activeLayer.opacity} onChange={(event) => updateLayerField(activeLayer.id, { opacity: Number(event.target.value) })} /></> : <p className="muted-copy">Select an editable layer to view properties.</p>}
        </div>
        <button className="add-layer-button" disabled={!activeCel || activeCel.layers.length >= 4} onClick={() => {
          try { const id = addLayer(engine, activeCel!.id); setActiveLayerId(id); }
          catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error'); }
        }}>＋ Add layer <span>{activeCel?.layers.length ?? 0}/4</span></button>
        <button className="delete-layer-button" disabled={!activeCel || activeCel.layers.length <= 1 || !activeLayer || activeLayer.locked} onClick={() => {
          try { removeLayer(engine, activeCel!.id, activeLayer!.id); setActiveLayerId(activeCel!.layers.find((layer) => layer.id !== activeLayer!.id)?.id ?? ''); }
          catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error'); }
        }}>Delete selected layer</button>
        <div className="plugin-panel-stack">
          {activePluginPanels.map(([key, panel]) => {
            const Panel = panel.component as ComponentType<PluginPanelProps>;
            return <section className="plugin-panel" key={key}><div className="plugin-panel-title">{panel.title}</div><Panel {...panelProps(panel.id)} /></section>;
          })}
        </div>
        <div className="plugin-card">
          <div className="plugin-card-top"><span className="plugin-icon">✿</span><span className={`plugin-status ${pluginEnabled ? 'on' : ''}`}>{pluginEnabled ? 'ACTIVE' : 'OPTIONAL'}</span></div>
          <strong>Coloring Mode</strong><p>Non-destructive fills, palette and outline-only draft mode.</p><p className="plugin-permissions">Trusted first-party code. Enabling grants document read/write, timeline read, canvas input/render, UI contributions, assets and plugin-local storage. No network permission requested.</p>
          <button onClick={() => void activatePlugin(!pluginEnabled)} disabled={pluginBusy}>{pluginBusy ? 'Working…' : pluginEnabled ? 'Disable plugin' : 'Enable plugin'} <span>→</span></button>
        </div>
      </aside>}
    </main>

    {showTimeline && <section className="timeline-dock">
      <div className="timeline-header">
        <div className="timeline-title"><span className="eyebrow">ANIMATION</span><strong>Timeline</strong><span className="timeline-count">{project.document.durationTicks} frames</span></div>
        <div className="playback-controls"><button className="transport-button" onClick={() => chooseFrame(0)} title="Go to first frame">|◀</button><button className="transport-button" onClick={() => chooseFrame(currentTick - 1)} title="Previous frame">◀</button><button className="play-button" onClick={togglePlayback} title="Play / pause">{playing ? 'Ⅱ' : '▶'}</button><button className="transport-button" onClick={() => chooseFrame(currentTick + 1)} title="Next frame">▶</button><button className="transport-button" onClick={() => chooseFrame(project.document.durationTicks - 1)} title="Go to last frame">▶|</button></div>
        <div className="timeline-options"><label>FPS <select value={playbackFps} onChange={(event) => setPlaybackFps(Number(event.target.value))}><option value={12}>12</option><option value={24}>24</option></select></label><button className={`loop-button ${loopPlayback ? 'active' : ''}`} onClick={() => setLoopPlayback((value) => !value)} title="Loop playback">↻</button><button className="icon-button subtle" onClick={() => setShowTimeline(false)} title="Hide timeline">⌄</button></div>
      </div>
      {!timelineEditsSupported && <div className="timeline-limit-notice" role="status">This project has {project.document.durationTicks} timeline positions. The first-release editor supports up to {MAX_USER_FRAME_COUNT}; only the first {MAX_USER_FRAME_COUNT} are shown and frame structure edits are disabled. The original document and full export remain intact.</div>}
      <div className="filmstrip-wrap">
        <div className="filmstrip-track-label"><span className="track-color" />{project.tracks.find((track) => track.id === activeTrackId)?.name ?? 'Animation'}<small>TRACK 01</small></div>
        <div className="filmstrip" id="filmstrip">
          {Array.from({ length: timelineFrameCount }, (_, tick) => <FrameTile key={tick} project={project} tick={tick} selected={tick === currentTick} registry={renderers} repository={repository} onClick={() => chooseFrame(tick)} />)}
          <button className="frame-add-tile" onClick={addBlank} disabled={!timelineEditsSupported} title="Add blank frame"><span>＋</span><small>NEW FRAME</small></button>
        </div>
      </div>
      <div className="timeline-footer"><div className="frame-actions"><button onClick={addBlank} disabled={!timelineEditsSupported}>＋ Blank frame</button><button onClick={duplicate} disabled={!timelineEditsSupported}>▣ Duplicate</button><button className="danger-quiet" onClick={remove} disabled={!timelineEditsSupported}>− Delete</button></div><div className="timeline-footer-right"><span>{frameRate.toFixed(frameRate % 1 ? 2 : 0)} FPS PROJECT</span><span className="tiny-dot" /> <span>AUTOSAVE ON</span></div></div>
    </section>}
    {!showTimeline && <button className="show-timeline-button" onClick={() => setShowTimeline(true)}>⌃ Show timeline</button>}

    <footer className="statusbar"><div><span className="status-mark">✳</span> {PRODUCT_NAME} <span className="muted-copy">· LOCAL WORKSPACE</span></div><div>{saveMessage}</div><div><span>{project.document.width} × {project.document.height}</span><span className="status-separator">·</span><span>{Math.round(viewportState.zoom * 100)}% ZOOM</span></div></footer>

    {toast && <div className={`toast ${toast.tone === 'error' ? 'error' : ''}`}>{toast.tone === 'error' ? '!' : '✓'} {toast.message}</div>}
    {modal.type && <Modal title={modalTitle(modal.type)} onClose={() => setModal({ type: null })}>
      {modal.type === 'projects' && <ProjectModal projects={projectList} onNew={createNewProject} onOpen={openProject} onExport={exportProject} onImport={handleImportInput} onClose={() => setModal({ type: null })} />}
      {modal.type === 'settings' && <SettingsModal onion={onion} setOnion={setOnion} project={project} setProjectRate={setPlaybackFps} />}
      {modal.type === 'export' && <ExportModal busy={exportBusy} progress={exportProgress} onPng={() => void runExport('png')} onPdf={() => void runExport('pdf')} onProject={exportProject} onClose={() => setModal({ type: null })} />}
      {modal.type === 'shortcuts' && <ShortcutsModal />}
    </Modal>}
    <input className="visually-hidden" id="project-import" type="file" accept=".ltproj,.zip,application/zip" onChange={handleImportInput} />
    {storageReady ? null : <div className="loading-curtain"><div className="loader-mark">L</div><div>Preparing your light table…</div></div>}
  </div>;
}

function ToolButton({ active, label, shortcut, onClick, children }: { active: boolean; label: string; shortcut?: string; onClick: () => void; children: ReactNode }): React.JSX.Element {
  return <button className={`rail-tool ${active ? 'active' : ''}`} onClick={onClick} title={`${label}${shortcut ? ` (${shortcut})` : ''}`}><span className="rail-tool-icon">{children}</span><span className="rail-tool-label">{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): React.JSX.Element {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div><span className="eyebrow">LIGHTTABLE WORKSPACE</span><h2>{title}</h2></div><button className="icon-button subtle" onClick={onClose} aria-label="Close dialog">×</button></header>{children}</section></div>;
}

function ProjectModal({ projects, onNew, onOpen, onExport, onImport, onClose }: {
  projects: Array<{ projectId: string; name: string; updatedAt: string; durationTicks: number }>;
  onNew: () => void; onOpen: (id: string) => void; onExport: () => void; onImport: (event: ChangeEvent<HTMLInputElement>) => void; onClose: () => void;
}): React.JSX.Element {
  return <div className="project-modal-content"><div className="project-modal-actions"><button className="modal-primary-action" onClick={onNew}>＋ New animation</button><label className="modal-secondary-action">↥ Import project<input type="file" accept=".ltproj,.zip,application/zip" onChange={onImport} /></label><button className="modal-secondary-action" onClick={onExport}>↓ Export current</button></div><div className="modal-section-heading">RECENT PROJECTS <span>{projects.length}</span></div><div className="project-list">{projects.length ? projects.map((item) => <button key={item.projectId} className="project-list-row" onClick={() => onOpen(item.projectId)}><span className="project-thumb">▤</span><span className="project-list-name"><strong>{item.name}</strong><small>{item.durationTicks} frames · Edited {new Date(item.updatedAt).toLocaleString()}</small></span><span className="project-open-arrow">↗</span></button>) : <div className="empty-project-list">Your saved animations will appear here.</div>}</div><div className="modal-footnote">Projects are stored locally in this browser. Export a .ltproj backup to move between devices.</div><button className="modal-close-text" onClick={onClose}>Close</button></div>;
}

function SettingsModal({ onion, setOnion, project, setProjectRate }: { onion: OnionSettings; setOnion: (value: OnionSettings) => void; project: ProjectDocumentV1; setProjectRate: (fps: number) => void }): React.JSX.Element {
  const [fps, setFps] = useState(project.document.frameRate.numerator / project.document.frameRate.denominator);
  return <div className="settings-modal-content"><div className="settings-group"><div className="settings-group-title">PLAYBACK</div><label className="settings-line"><span>Project frame rate</span><select value={fps} onChange={(event) => { const next = Number(event.target.value); setFps(next); setProjectRate(next); }}><option value={12}>12 frames per second</option><option value={24}>24 frames per second</option></select></label></div><div className="settings-group"><div className="settings-group-title">ONION SKIN</div><label className="settings-toggle"><span><strong>Enable onion skin</strong><small>Display previous and following drawings</small></span><input type="checkbox" checked={onion.enabled} onChange={(event) => setOnion({ ...onion, enabled: event.target.checked })} /></label><label className="settings-line"><span>Previous frames</span><select value={onion.before} onChange={(event) => setOnion({ ...onion, before: Number(event.target.value) })}><option value={0}>Off</option><option value={1}>1 frame</option><option value={2}>2 frames</option><option value={3}>3 frames</option></select></label><label className="settings-line"><span>Following frames</span><select value={onion.after} onChange={(event) => setOnion({ ...onion, after: Number(event.target.value) })}><option value={0}>Off</option><option value={1}>1 frame</option><option value={2}>2 frames</option><option value={3}>3 frames</option></select></label><label className="settings-line"><span>Previous opacity</span><strong>{Math.round(onion.beforeOpacity * 100)}%</strong></label><input type="range" min="0.05" max="0.65" step="0.05" value={onion.beforeOpacity} onChange={(event) => setOnion({ ...onion, beforeOpacity: Number(event.target.value) })} /><label className="settings-line"><span>Following opacity</span><strong>{Math.round(onion.afterOpacity * 100)}%</strong></label><input type="range" min="0.05" max="0.65" step="0.05" value={onion.afterOpacity} onChange={(event) => setOnion({ ...onion, afterOpacity: Number(event.target.value) })} /></div><div className="modal-footnote">The document frame rate is saved with the project. Onion skin is an editor aid and is excluded from exports.</div></div>;
}

function ExportModal({ busy, progress, onPng, onPdf, onProject, onClose }: { busy: boolean; progress: { label: string; fraction: number } | null; onPng: () => void; onPdf: () => void; onProject: () => void; onClose: () => void }): React.JSX.Element {
  return <div className="export-modal-content"><p className="modal-intro">Create clean artwork outputs from a revision-pinned snapshot. Editor controls, onion skin and viewport transforms are not included.</p><div className="export-choice"><div className="export-choice-icon">▦</div><div><strong>PNG image sequence</strong><small>One numbered PNG per frame, packaged in a ZIP file.</small></div><button disabled={busy} onClick={onPng}>Export ZIP ↗</button></div><div className="export-choice"><div className="export-choice-icon">▤</div><div><strong>A4 landscape PDF</strong><small>Printable pages with registration marks and peg bar.</small></div><button disabled={busy} onClick={onPdf}>Export PDF ↗</button></div><div className="export-choice"><div className="export-choice-icon">⬡</div><div><strong>Editable project</strong><small>Preserves drawings, exposures, extensions and binary assets.</small></div><button disabled={busy} onClick={onProject}>Export .ltproj ↗</button></div>{progress && <div className="export-progress"><div className="progress-line"><span>{progress.label}</span><strong>{Math.round(progress.fraction * 100)}%</strong></div><div className="progress-track"><span style={{ width: `${progress.fraction * 100}%` }} /></div></div>}<div className="modal-footnote">PDF output uses Fit to A4. Calibrated 1:1 physical printing is not available unless physical document dimensions and printer scaling are verified.</div><button className="modal-close-text" onClick={onClose} disabled={busy}>Close</button></div>;
}

function ShortcutsModal(): React.JSX.Element {
  const shortcuts = [['B', 'Pencil tool'], ['E', 'Eraser tool'], ['Space', 'Play / pause'], ['← / →', 'Previous / next frame'], ['H', 'Toggle onion skin'], ['F', 'Flip canvas horizontally'], ['⌘ / Ctrl + Z', 'Undo'], ['⌘ / Ctrl + Shift + Z', 'Redo'], ['⌘ / Ctrl + Y', 'Redo'], ['⌘ / Ctrl + wheel', 'Zoom at pointer']];
  return <div className="shortcuts-list">{shortcuts.map(([key, action]) => <div key={key}><kbd>{key}</kbd><span>{action}</span></div>)}</div>;
}

function modalTitle(type: NonNullable<ModalState['type']>): string {
  return ({ projects: 'Your projects', settings: 'Workspace settings', export: 'Export animation', shortcuts: 'Keyboard shortcuts' })[type];
}
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}
function slugify(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lighttable-animation'; }
