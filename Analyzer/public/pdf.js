let library;

export class PdfPreview {
  constructor() {
    this.container = document.querySelector('#pdf-canvas-wrap');
    this.label = document.querySelector('#pdf-page-label');
    this.status = document.querySelector('#pdf-status');
    this.zoom = document.querySelector('#pdf-zoom');
    this.previous = document.querySelector('#pdf-previous');
    this.next = document.querySelector('#pdf-next');
    this.sequence = 0; this.renderSequence = 0;
    this.previous.addEventListener('click', () => { this.pageNumber--; this.render(); });
    this.next.addEventListener('click', () => { this.pageNumber++; this.render(); });
    this.zoom.addEventListener('change', () => this.render());
    let resizeTimer;
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      if (this.document && this.zoom.value === 'fit' && this.container.clientWidth > 0) resizeTimer = setTimeout(() => this.render(), 120);
    }).observe(this.container);
  }

  async open(url) {
    this.close();
    const sequence = ++this.sequence;
    this.status.textContent = 'Wczytywanie PDF…';
    this.zoom.value = 'fit'; this.pageNumber = 1;
    try {
      library ||= await import('./vendor/pdfjs/build/pdf.mjs');
      if (sequence !== this.sequence) return;
      library.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/build/pdf.worker.mjs', import.meta.url).href;
      const loading = this.loading = library.getDocument({ url, cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href, cMapPacked: true, standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href, wasmUrl: new URL('./vendor/pdfjs/wasm/', import.meta.url).href, isEvalSupported: false });
      const document = await loading.promise;
      if (sequence !== this.sequence) return;
      this.document = document;
      await this.render();
    } catch (error) {
      if (sequence === this.sequence) this.status.textContent = `Błąd PDF: ${error.message}. Użyj „Otwórz PDF”.`;
    }
  }

  async render() {
    if (!this.document || !this.container.clientWidth) return;
    const sequence = ++this.renderSequence;
    this.renderTask?.cancel();
    this.status.textContent = 'Renderowanie…';
    this.previous.disabled = this.pageNumber <= 1;
    this.next.disabled = this.pageNumber >= this.document.numPages;
    this.label.textContent = `Strona ${this.pageNumber} / ${this.document.numPages}`;
    try {
      const page = await this.document.getPage(this.pageNumber);
      if (sequence !== this.renderSequence) return;
      const natural = page.getViewport({ scale: 1 });
      const scale = this.zoom.value === 'fit' ? Math.max(.1, (this.container.clientWidth - 40) / natural.width) : Number(this.zoom.value);
      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(20_000_000 / (viewport.width * viewport.height)));
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', `Rysunek PDF, strona ${this.pageNumber}`);
      canvas.width = Math.floor(viewport.width * pixelRatio); canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      this.container.replaceChildren(canvas);
      this.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      await this.renderTask.promise;
      if (sequence === this.renderSequence) this.status.textContent = `PDF · ${Math.round(scale * 100)}%`;
    } catch (error) {
      if (sequence === this.renderSequence && error.name !== 'RenderingCancelledException') this.status.textContent = `Nie można wyświetlić PDF: ${error.message}`;
    }
  }

  close() {
    this.sequence++; this.renderSequence++;
    this.renderTask?.cancel(); this.renderTask = null;
    this.loading?.destroy().catch(() => {}); this.loading = null; this.document = null;
    this.container.replaceChildren(); this.status.textContent = ''; this.label.textContent = 'Strona —';
    this.previous.disabled = true; this.next.disabled = true;
  }
}
