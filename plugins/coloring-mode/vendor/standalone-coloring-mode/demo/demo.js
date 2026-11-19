import { attachBrowserColoringMode } from '../src/adapters/browser-host-adapter.js';

const $ = id => document.getElementById(id);
const baseCanvas = $('colorBase');
const detailCanvas = $('colorDetail');
const outlineCanvas = $('outline');
const base = baseCanvas.getContext('2d');
const detail = detailCanvas.getContext('2d');
const outline = outlineCanvas.getContext('2d');
const colorRenderGate = { base: true, detail: true };
const counts = { color: 0, outline: 0, frames: 0 };
let lastMeasure = performance.now();
let frameCount = 0;

const coloring = attachBrowserColoringMode({
  colorLayers: [
    { id: 'base', element: baseCanvas },
    { id: 'detail', element: detailCanvas },
  ],
  onColorRenderingEnabled(id, enabled) {
    colorRenderGate[id] = enabled;
  },
  onChange(snapshot) {
    $('draftToggle').checked = snapshot.draft;
    $('status').textContent = snapshot.draft
      ? 'DRAFT MODE · color surfaces hidden · color rendering bypassed'
      : 'COLOR MODE · ' + Object.entries(snapshot.layers).map(([id, s]) => `${id}: ${s.enabled ? 'on' : 'off'}`).join(' · ');
  },
});

function resize() {
  const rect = $('stage').getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const canvas of [baseCanvas, detailCanvas, outlineCanvas]) {
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.getContext('2d').setTransform(canvas.width / 640, 0, 0, canvas.height / 360, 0, 0);
  }
  $('log').textContent = `Canvas backing size: ${baseCanvas.width} × ${baseCanvas.height} px · DPR ${dpr}`;
}
new ResizeObserver(resize).observe($('stage'));
resize();

function drawBaseColor() {
  base.clearRect(0, 0, 640, 360);
  base.fillStyle = '#d7b39d';
  base.beginPath(); base.ellipse(320, 185, 112, 125, 0, 0, Math.PI * 2); base.fill();
  base.fillStyle = '#e8cbbb';
  base.beginPath(); base.ellipse(320, 185, 88, 99, 0, 0, Math.PI * 2); base.fill();
  counts.color++;
}
function drawDetailColor() {
  detail.clearRect(0, 0, 640, 360);
  detail.fillStyle = '#729b86';
  for (const x of [278, 362]) { detail.beginPath(); detail.ellipse(x, 165, 15, 19, 0, 0, Math.PI * 2); detail.fill(); }
  detail.fillStyle = '#c38d54';
  detail.beginPath(); detail.ellipse(320, 215, 23, 14, 0, 0, Math.PI * 2); detail.fill();
  counts.color++;
}
function drawOutlines() {
  outline.clearRect(0, 0, 640, 360);
  outline.strokeStyle = '#303a40'; outline.lineWidth = 3; outline.lineJoin = 'round';
  outline.beginPath(); outline.ellipse(320, 185, 112, 125, 0, 0, Math.PI * 2); outline.stroke();
  outline.beginPath(); outline.ellipse(320, 185, 88, 99, 0, 0, Math.PI * 2); outline.stroke();
  for (const x of [278, 362]) { outline.beginPath(); outline.ellipse(x, 165, 15, 19, 0, 0, Math.PI * 2); outline.stroke(); }
  outline.beginPath(); outline.moveTo(297, 215); outline.quadraticCurveTo(320, 238, 343, 215); outline.stroke();
  counts.outline++;
}

// This is the host application's loop, not part of the coloring module.
function hostFrame(now) {
  if (colorRenderGate.base) drawBaseColor();
  if (colorRenderGate.detail) drawDetailColor();
  drawOutlines();
  frameCount++;
  if (now - lastMeasure >= 500) {
    $('fps').textContent = Math.round(frameCount * 1000 / (now - lastMeasure));
    $('outlineFrames').textContent = counts.outline.toLocaleString();
    $('colorFrames').textContent = counts.color.toLocaleString();
    frameCount = 0; lastMeasure = now;
  }
  requestAnimationFrame(hostFrame);
}
requestAnimationFrame(hostFrame);

$('draftToggle').addEventListener('change', event => {
  coloring.setDraft(event.currentTarget.checked);
  $('log').textContent = event.currentTarget.checked
    ? 'Draft enabled synchronously. Color surfaces are hidden and color draw gates are off.'
    : 'Color mode restored. Previously enabled color buffers are visible and can render again.';
});
$('restore').addEventListener('click', () => coloring.setDraft(false));
$('toggleBase').addEventListener('click', () => {
  const enabled = !coloring.getLayerState('base').enabled;
  coloring.setLayerEnabled('base', enabled);
  $('toggleBase').textContent = `Base fill: ${enabled ? 'on' : 'off'}`;
  $('toggleBase').setAttribute('aria-pressed', String(enabled));
});
$('toggleDetail').addEventListener('click', () => {
  const enabled = !coloring.getLayerState('detail').enabled;
  coloring.setLayerEnabled('detail', enabled);
  $('toggleDetail').textContent = `Detail fill: ${enabled ? 'on' : 'off'}`;
  $('toggleDetail').setAttribute('aria-pressed', String(enabled));
});

window.addEventListener('pagehide', () => coloring.detach(), { once: true });
