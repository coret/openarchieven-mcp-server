import { App } from '@modelcontextprotocol/ext-apps';
import OpenSeadragon from 'openseadragon';

// ── Shape of each page in the tool's structuredContent (see server.ts) ──────
interface ViewerPage {
  id: string;
  page: string;
  /** IIIF info.json URL when derivable (enables deep zoom). */
  infoJson?: string;
  /** Plain image URL fallback (non-IIIF projects). */
  imageUrl?: string;
  thumbUrl?: string;
  transcript: string;
  sourceUrl?: string;
  archive?: string;
}

interface HostCtx {
  theme?: string;
  styles?: { variables?: Record<string, string | undefined> };
  displayMode?: string;
  availableDisplayModes?: string[];
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};
const mainEl = $('main');

let pages: ViewerPage[] = [];
let highlightTerm = '';
let current = 0;
let viewer: OpenSeadragon.Viewer | null = null;

// ── OpenSeadragon tile source from a page ───────────────────────────────────
function tileSourceFor(p: ViewerPage): string | { type: string; url: string } | null {
  if (p.infoJson) return p.infoJson; // IIIF deep zoom (OSD fetches info.json)
  if (p.imageUrl) return { type: 'image', url: p.imageUrl }; // flat fallback
  return null;
}

function ensureViewer(): OpenSeadragon.Viewer {
  if (viewer) return viewer;
  viewer = OpenSeadragon({
    element: $('osd'),
    showNavigationControl: false, // custom toolbar buttons (avoids button-image CSP)
    showNavigator: true,
    navigatorPosition: 'BOTTOM_RIGHT',
    gestureSettingsMouse: { clickToZoom: false },
    // IIIF/image hosts all send `Access-Control-Allow-Origin: *`; request images
    // with crossorigin so the canvas isn't tainted (required for OSD rendering).
    crossOriginPolicy: 'Anonymous',
    visibilityRatio: 1,
    minZoomImageRatio: 0.8,
    maxZoomPixelRatio: 3,
  });
  return viewer;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
function highlight(text: string, term: string): string {
  const safe = escapeHtml(text);
  if (!term) return safe;
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

function renderRail(): void {
  const rail = $('rail');
  rail.innerHTML = '';
  if (pages.length <= 1) { rail.style.display = 'none'; return; }
  rail.style.display = '';
  pages.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'thumb' + (i === current ? ' active' : '');
    el.innerHTML =
      (p.thumbUrl ? `<img src="${p.thumbUrl}" alt="pagina ${escapeHtml(p.page)}">` : '') +
      `<div class="n">${escapeHtml(p.page || String(i + 1))}</div>`;
    el.addEventListener('click', () => showPage(i));
    rail.appendChild(el);
  });
}

function renderPanel(): void {
  const p = pages[current];
  if (!p) return;
  const t = $('transcript');
  t.className = '';
  t.innerHTML = p.transcript
    ? highlight(p.transcript, highlightTerm)
    : '<span class="empty">Geen transcriptietekst.</span>';
  $('meta').innerHTML =
    (p.archive ? `${escapeHtml(p.archive)}<br>` : '') +
    `Pagina ${escapeHtml(p.page || String(current + 1))} &middot; id ${escapeHtml(p.id)}` +
    (p.sourceUrl
      ? `<br><a href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener">Bekijk bij bronarchief &rarr;</a>`
      : '');
  $('pageLabel').textContent = `Pagina ${current + 1} / ${pages.length}`;
}

function showPage(i: number): void {
  if (i < 0 || i >= pages.length) return;
  current = i;
  const ts = tileSourceFor(pages[i]!);
  const v = ensureViewer();
  if (ts) v.open(ts as string); else v.close();
  renderRail();
  renderPanel();
  // Keep the model aware of what the user is looking at.
  const p = pages[i]!;
  app.updateModelContext({
    content: [{
      type: 'text',
      text: `User is viewing page ${p.page || i + 1} (id ${p.id})` +
        (p.archive ? ` from ${p.archive}.` : '.'),
    }],
  }).catch(() => { /* host may not support it */ });
}

function render(): void {
  if (!pages.length) {
    $('transcript').textContent = 'Geen pagina&apos;s om te tonen.';
    return;
  }
  showPage(0);
}

// ── Toolbar ─────────────────────────────────────────────────────────────────
($('zoomIn') as HTMLButtonElement).onclick = () => viewer?.viewport.zoomBy(1.4).applyConstraints();
($('zoomOut') as HTMLButtonElement).onclick = () => viewer?.viewport.zoomBy(0.7).applyConstraints();
($('reset') as HTMLButtonElement).onclick = () => viewer?.viewport.goHome();
($('full') as HTMLButtonElement).onclick = async () => {
  const ctx = app.getHostContext() as HostCtx | undefined;
  const next = ctx?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  if (ctx?.availableDisplayModes?.includes(next)) {
    const res = await app.requestDisplayMode({ mode: next });
    mainEl.classList.toggle('fullscreen', (res as { mode?: string }).mode === 'fullscreen');
  }
};

// ── Host theming ──────────────────────────────────────────────────────────────
function applyHostContext(ctx: HostCtx | undefined): void {
  if (!ctx) return;
  if (ctx.theme) document.documentElement.setAttribute('data-theme', ctx.theme);
  const vars = ctx.styles?.variables;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      if (v != null) document.documentElement.style.setProperty(k, String(v));
    }
  }
  mainEl.classList.toggle('fullscreen', ctx.displayMode === 'fullscreen');
}

// ── MCP Apps wiring ───────────────────────────────────────────────────────────
const app = new App({ name: 'Open Archieven viewer', version: '1.1.0' });

// Set handlers BEFORE connect() so the initial tool result is not missed.
app.ontoolresult = (params) => {
  const sc = (params.structuredContent ?? {}) as { pages?: ViewerPage[]; highlightTerm?: string };
  pages = Array.isArray(sc.pages) ? sc.pages : [];
  highlightTerm = sc.highlightTerm ?? '';
  render();
};
app.onhostcontextchanged = (ctx) => applyHostContext(ctx as unknown as HostCtx);
app.onteardown = async () => { viewer?.destroy(); viewer = null; return {}; };

void app.connect().then(() => {
  applyHostContext(app.getHostContext() as HostCtx | undefined);
});
