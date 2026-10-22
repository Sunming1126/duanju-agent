/** Graph scheduling regression checks; no browser, service or external API is started. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { boot, read } from './check_frontend.mjs';

async function graphHarness({ reduced = false, count = 300 } = {}) {
  const app = boot(); const { context, document, el } = app;
  let nextFrame = 1, paints = 0, layouts = 0;
  const frames = new Map();
  context.requestAnimationFrame = (callback) => { const id = nextFrame++; frames.set(id, callback); return id; };
  context.cancelAnimationFrame = (id) => frames.delete(id);
  context.matchMedia = () => ({ matches: reduced });
  context.devicePixelRatio = 3;
  context.esc = (value) => String(value ?? '');
  context.toast = () => {};
  const canvas = el('graphCanvas'), wrap = canvas.parentElement;
  wrap.clientWidth = 900; wrap.clientHeight = 600;
  canvas.getBoundingClientRect = () => { layouts++; return { left: 0, top: 0 }; };
  canvas.getContext = () => new Proxy({}, { get: (_, key) => key === 'clearRect' ? () => paints++ : () => {}, set: () => true });
  Object.defineProperty(document, 'hidden', { value: false, writable: true });
  context.fetch = async () => ({ json: async () => ({
    nodes: Array.from({ length: count }, (_, i) => ({ id: 'node' + i, name: 'Story ' + i, type: 'drama', props: {}, category_ids: [] })),
    links: Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({ src: 'node' + i, dst: 'node' + (i + 1), weight: 1 })),
    type_names: {}, clusters: [], graph: {}, items: [], total: count, shown: count,
  }) });
  vm.runInContext(read('static/graph.js'), context);
  context.switchView('graph');
  await new Promise((resolve) => setImmediate(resolve));
  const advance = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); };
  const settle = () => { let steps = 0; while (frames.size && steps < 200) { advance(); steps++; } assert.equal(frames.size, 0, 'Graph must stop requesting animation frames when settled'); return steps; };
  return { ...app, frames, canvas, advance, settle, paints: () => paints, layouts: () => layouts };
}
const start = performance.now();
const app = await graphHarness();
assert(app.frames.size > 0, 'A newly shown graph should have a frame');
assert.equal(app.canvas.width, 1800, 'High-DPI rendering is capped at 2x');
app.context.switchView('hub'); assert.equal(app.frames.size, 0, 'Leaving the graph cancels work');
const layouts = app.layouts(); app.context.emit('mousemove', { target: app.document.body });
assert.equal(app.layouts(), layouts, 'Hidden graphs do not measure layout on pointer movement');
app.context.switchView('graph');
const steps = app.settle(); assert(steps <= 110, 'Cooling must finish within a bounded number of frames');
const painted = app.paints();
app.canvas.dispatchEvent({ type: 'wheel', clientX: 100, clientY: 100, deltaY: -80, preventDefault() {} });
app.canvas.dispatchEvent({ type: 'wheel', clientX: 100, clientY: 100, deltaY: 40, preventDefault() {} });
assert.equal(app.frames.size, 1, 'Input events are coalesced to one repaint');
app.advance(); assert.equal(app.paints(), painted + 1); assert.equal(app.frames.size, 0, 'Zoom must not restart the simulation');
app.document.hidden = true;
app.document.dispatchEvent({ type: 'visibilitychange' }); assert.equal(app.frames.size, 0);
app.document.hidden = false;
app.document.dispatchEvent({ type: 'visibilitychange' }); assert.equal(app.frames.size, 1);
app.advance(); assert.equal(app.frames.size, 0);
const listeners = app.el('btnGraphLoad').events.click.length;
app.context.GraphView.activate(); app.settle();
assert.equal(app.el('btnGraphLoad').events.click.length, listeners, 'Returning from idle must not rebind toolbar handlers');
await app.context.GraphView.load(); assert.equal(app.frames.size, 1, 'Fresh data wakes a settled graph');
app.document.hidden = true;
app.document.dispatchEvent({ type: 'visibilitychange' }); assert.equal(app.frames.size, 0, 'A hidden browser tab cancels an active simulation');
app.context.switchView('studio'); app.document.hidden = false;
app.document.dispatchEvent({ type: 'visibilitychange' }); assert.equal(app.frames.size, 0, 'Returning to another workspace must not wake the graph');
const reduced = await graphHarness({ reduced: true }); assert.equal(reduced.settle(), 1, 'Reduced-motion mode does not play the settling animation');
const empty = await graphHarness({ count: 0 }); assert.equal(empty.settle(), 1, 'An empty graph never schedules an endless loop');
console.log(`PASS: 300-node graph settles in ${steps} frames, hidden/idle work stops, zoom redraws once, listeners stay unique, 2x pixel cap and reduced-motion handling. Node test time: ${Math.round(performance.now() - start)}ms (not a browser FPS measurement).`);
