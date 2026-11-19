/**
 * Example SDK consumer. This is a contract example only; it is not loaded by
 * the host and contains no production brush/renderer implementation.
 */
import type {
  LightTablePlugin,
  NodeInfo,
  PointerSample,
  ToolContext,
  ToolGesture,
  DisposableStore,
} from "@lighttable/plugin-sdk";

interface ActiveStroke {
  gesture: ToolGesture;
  target: NonNullable<ReturnType<ToolContext["getActiveTarget"]>>;
  baseRevision: number;
  samples: Array<{ x: number; y: number; pressure: number; timeOffsetMs: number }>;
  startedAt: number;
}

function appendSample(active: ActiveStroke, sample: PointerSample): void {
  const allSamples = sample.coalesced?.length ? sample.coalesced : [sample];
  for (const point of allSamples) {
    active.samples.push({
      x: point.document.x,
      y: point.document.y,
      pressure: Math.max(0, Math.min(1, point.pressure)),
      timeOffsetMs: Math.max(0, point.timeStamp - active.startedAt),
    });
  }
}

let registrationScope: DisposableStore | undefined;
let activeGestures = new Map<number, ActiveStroke>();

const plugin: LightTablePlugin = {
  manifest: {
    id: "com.example.reference-tool",
    version: "1.0.0",
    apiVersionRange: "^1.0.0",
  },

  activate(api) {
    registrationScope = api.registrations;
    activeGestures = new Map<number, ActiveStroke>();

    registrationScope.add(api.tools.register({
      id: "reference-path-tool",
      name: "Reference Path",
      icon: "pencil",
      tooltip: "Example plugin tool demonstrating normalized input and transactions",

      onPointerDown(sample, context) {
        const target = context.getActiveTarget();
        if (!target) return;

        const gesture = context.beginGesture({
          label: "Add reference path",
          pointerId: sample.pointerId,
        });

        const active: ActiveStroke = {
          gesture,
          target,
          baseRevision: context.document.getInfo().revision,
          samples: [],
          startedAt: sample.timeStamp,
        };
        appendSample(active, sample);
        activeGestures.set(sample.pointerId, active);

        gesture.updatePreview((environment) => {
          const ctx = environment.ctx;
          const points = active.samples;
          if (points.length === 0) return;
          ctx.save();
          ctx.strokeStyle = "#2563EB";
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i += 1) {
            ctx.lineTo(points[i].x, points[i].y);
          }
          ctx.stroke();
          ctx.restore();
        });
      },

      onPointerMove(sample) {
        const active = activeGestures.get(sample.pointerId);
        if (!active) return;
        appendSample(active, sample);
        // Preview callback reads the current sample array on the next host invalidation.
        active.gesture.updatePreview((environment) => {
          const ctx = environment.ctx;
          const points = active.samples;
          if (points.length === 0) return;
          ctx.save();
          ctx.strokeStyle = "#2563EB";
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
          ctx.stroke();
          ctx.restore();
        });
      },

      onPointerUp(sample) {
        const active = activeGestures.get(sample.pointerId);
        if (!active) return;
        appendSample(active, sample);
        activeGestures.delete(sample.pointerId);

        if (active.samples.length === 0) {
          active.gesture.cancel("user-cancel");
          return;
        }

        const node: NodeInfo = {
          id: crypto.randomUUID(),
          type: "core.path",
          typeVersion: 1,
          transform: [1, 0, 0, 1, 0, 0],
          visible: true,
          data: {
            samples: active.samples,
            paint: {
              color: "#2563EB",
              width: 3,
              opacity: 1,
              cap: "round",
              join: "round",
              composite: "source-over",
            },
            smoothing: { kind: "quadratic" },
          },
        };

        active.gesture.commit(
          { label: "Add reference path", expectedRevision: active.baseRevision },
          (tx) => {
            tx.nodes.insert({
              celId: active.target.celId,
              layerId: active.target.layerId,
              node,
            });
          },
        );
      },

      onCancel(reason) {
        for (const active of activeGestures.values()) active.gesture.cancel(reason);
        activeGestures.clear();
      },
    }));
  },

  deactivate() {
    for (const active of activeGestures.values()) active.gesture.cancel("plugin-disabled");
    activeGestures.clear();
    registrationScope?.clear();
    registrationScope = undefined;
  },
};

export default plugin;
