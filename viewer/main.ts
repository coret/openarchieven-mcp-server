import { App } from '@modelcontextprotocol/ext-apps';
import OpenSeadragon from 'openseadragon';

// ── Shape of each page in the tool's structuredContent (see server.ts) ──────
interface SourceRef {
  nr?: string;
  title?: string;
  url?: string;
}

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
  /** Holding institution (source_archive). */
  archive?: string;
  archiveIsil?: string;
  archiveLogo?: string;
  /** archive_number — the fonds/collection the page belongs to. */
  archiveRef?: SourceRef;
  /** inventory_number within the fonds. */
  inventoryRef?: SourceRef;
}

interface HostCtx {
  theme?: string;
  styles?: { variables?: Record<string, string | undefined> };
  displayMode?: string;
  availableDisplayModes?: string[];
  /** Notches and, on web/desktop, the host's chat composer overlaying the bottom. */
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
  containerDimensions?: unknown;
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
let debug = false; // TEMPORARY: set by view_transcription({debug:true}) — see renderDiag()

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
    navigatorPosition: 'TOP_RIGHT', // BOTTOM_RIGHT would sit under the host composer

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

/** A labelled source row (archive / inventory); empty when the ref carries nothing. */
function refRow(label: string, r?: SourceRef): string {
  if (!r) return '';
  const inner = [r.nr, r.title].filter((x): x is string => !!x).map(escapeHtml).join(' &middot; ');
  if (!inner && !r.url) return '';
  const value = r.url
    ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${inner || escapeHtml(r.url)}</a>`
    : inner;
  return `<div class="src-row"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function renderPanel(): void {
  const p = pages[current];
  if (!p) return;
  const t = $('transcript');
  t.className = '';
  t.innerHTML = p.transcript
    ? highlight(p.transcript, highlightTerm)
    : '<span class="empty">Geen transcriptietekst.</span>';

  const head =
    p.archive || p.archiveLogo
      ? `<div class="src-head">` +
        (p.archiveLogo ? `<img class="src-logo" src="${escapeHtml(p.archiveLogo)}" alt="">` : '') +
        `<div>` +
        (p.archive ? `<div class="src-name">${escapeHtml(p.archive)}</div>` : '') +
        (p.archiveIsil ? `<div class="src-isil">${escapeHtml(p.archiveIsil)}</div>` : '') +
        `</div></div>`
      : '';

  $('meta').innerHTML =
    head +
    `<dl class="src-rows">` +
    refRow('Archief', p.archiveRef) +
    refRow('Inventaris', p.inventoryRef) +
    `<div class="src-row"><dt>Pagina</dt><dd>${escapeHtml(p.page || String(current + 1))}</dd></div>` +
    `</dl>` +
    (p.sourceUrl
      ? `<a class="src-link" href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener">Bekijk bij bronarchief &rarr;</a>`
      : '');

  // Not every archive has a logo (404) — drop the image rather than show a broken icon.
  const logo = document.querySelector<HTMLImageElement>('#meta .src-logo');
  logo?.addEventListener('error', () => logo.remove());

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
  // 1) Prefer the native Fullscreen API. An OS-level fullscreen element renders
  //    above the host's chat composer, so nothing gets covered. Only works if
  //    the host delegates the `fullscreen` permission policy to our iframe —
  //    the MCP Apps permission model can't request it, so feature-detect and
  //    fall back. (requestFullscreen must be called synchronously in the click
  //    handler to keep the user activation; do it before any await.)
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => { /* ignore */ });
    return;
  }
  if (document.fullscreenEnabled) {
    try {
      await mainEl.requestFullscreen();
      return; // success — :fullscreen styling applies, no composer to dodge
    } catch {
      /* host blocked it — fall through to host-mediated display mode */
    }
  }
  // 2) Host-mediated fullscreen: the host resizes the iframe and overlays its
  //    composer, so #main.fullscreen reserves a bottom strip.
  const ctx = app.getHostContext() as HostCtx | undefined;
  const next = ctx?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  if (ctx?.availableDisplayModes?.includes(next)) {
    const res = await app.requestDisplayMode({ mode: next });
    mainEl.classList.toggle('fullscreen', (res as { mode?: string }).mode === 'fullscreen');
  }
};

// ── TEMPORARY diagnostic ────────────────────────────────────────────────────
// Surfaces the live host context so we can see what Claude actually reports
// (displayMode, safeAreaInsets, containerDimensions) vs the iframe's own heights.
// Only shown when the tool is called with debug:true. Remove once the composer
// overlap is confirmed fixed and the bottom floor is tuned.
function renderDiag(): void {
  if (!debug) return;
  const el = document.getElementById('diag');
  if (!el) return;
  const ctx = (app.getHostContext() ?? {}) as HostCtx;
  el.textContent = JSON.stringify(
    {
      displayMode: ctx.displayMode,
      availableDisplayModes: ctx.availableDisplayModes,
      safeAreaInsets: ctx.safeAreaInsets,
      containerDimensions: ctx.containerDimensions,
      'window.innerHeight': window.innerHeight,
      'documentElement.clientHeight': document.documentElement.clientHeight,
    },
    null,
    2,
  );
  el.style.display = 'block';
}
document.getElementById('diag')?.addEventListener('click', () => {
  const el = document.getElementById('diag');
  if (el) el.style.display = 'none';
});

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
  // Reserve host safe areas (notch + fullscreen chat composer) as #main padding.
  const ins = ctx.safeAreaInsets;
  const root = document.documentElement.style;
  root.setProperty('--sa-top', `${ins?.top ?? 0}px`);
  root.setProperty('--sa-right', `${ins?.right ?? 0}px`);
  root.setProperty('--sa-bottom', `${ins?.bottom ?? 0}px`);
  root.setProperty('--sa-left', `${ins?.left ?? 0}px`);
  mainEl.classList.toggle('fullscreen', ctx.displayMode === 'fullscreen');
  renderDiag();
}

// ── MCP Apps wiring ───────────────────────────────────────────────────────────
const app = new App({ name: 'Open Archieven viewer', version: '1.1.0' });

// Set handlers BEFORE connect() so the initial tool result is not missed.
app.ontoolresult = (params) => {
  const sc = (params.structuredContent ?? {}) as {
    pages?: ViewerPage[];
    highlightTerm?: string;
    debug?: boolean;
  };
  pages = Array.isArray(sc.pages) ? sc.pages : [];
  highlightTerm = sc.highlightTerm ?? '';
  debug = sc.debug === true;
  render();
  renderDiag();
};
app.onhostcontextchanged = (ctx) => applyHostContext(ctx as unknown as HostCtx);
app.onteardown = async () => { viewer?.destroy(); viewer = null; return {}; };

void app.connect().then(() => {
  applyHostContext(app.getHostContext() as HostCtx | undefined);
});
