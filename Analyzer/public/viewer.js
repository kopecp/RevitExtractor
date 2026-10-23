import { VisibilityState, ViewerVisibility, viewerCategories } from './visibility.js';
import { createSourceTreePanel } from './source-tree.js';

const SDK = 'https://developer.api.autodesk.com/modelderivative/v2/viewers/7.130.0/';
let sdkPromise;

function loadSDK() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = `${SDK}style.min.css`; document.head.append(css);
    const script = document.createElement('script');
    script.src = `${SDK}viewer3D.min.js`;
    const timeout = setTimeout(() => reject(new Error('Nie udało się pobrać silnika 3D. Sprawdź połączenie z internetem i odśwież stronę.')), 45000);
    script.onerror = () => { clearTimeout(timeout); reject(new Error('Silnik 3D jest niedostępny. Sprawdź dostęp do developer.api.autodesk.com.')); };
    script.onload = () => {
      Autodesk.Viewing.Initializer({ env: 'Local', language: 'en', useADP: false, disableAnalytics: true, optOutTrackingByDefault: true }, () => { clearTimeout(timeout); resolve(); });
    };
    document.head.append(script);
  });
  sdkPromise.catch(() => { sdkPromise = null; });
  return sdkPromise;
}

export class ModelViewer {
  constructor(container, events) {
    this.container = container;
    this.events = events;
    this.viewer = null;
    this.geometryIds = new Set();
    this.loadId = 0;
    this.observer = new ResizeObserver(() => this.viewer?.resize());
    this.observer.observe(container);
  }

  async load(view, sourceRequest) {
    this.cancelLoad?.();
    this.clearSources();
    this.sourceRequest = sourceRequest;
    const loadId = ++this.loadId;
    this.ready = false;
    this.geometryIds.clear();
    await loadSDK();
    if (loadId !== this.loadId) return;
    this.viewer?.finish();
    this.container.replaceChildren();
    const viewer = this.viewer = new Autodesk.Viewing.GuiViewer3D(this.container, { extensions: ['Autodesk.Section'] });
    const result = viewer.start();
    if (result !== 0) throw new Error(`Nie można uruchomić WebGL (kod ${result}). Włącz akcelerację sprzętową w przeglądarce.`);
    viewer.setTheme('light-theme');
    viewer.setBackgroundColor(238, 243, 239, 238, 243, 239);
    viewer.setGroundShadow(false);
    viewer.setGroundReflection(false);
    viewer.setGhosting(false);
    viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, event => this.events.select(event.dbIdArray));
    viewer.addEventListener(Autodesk.Viewing.PROGRESS_UPDATE_EVENT, event => {
      if (!this.ready && Number.isFinite(event.percent)) this.events.progress(Math.round(event.percent));
    });
    return new Promise((resolve, reject) => {
      this.cancelLoad = () => { clearTimeout(timeout); resolve(); this.cancelLoad = null; };
      const timeout = setTimeout(() => {
        if (!this.ready && loadId === this.loadId) reject(new Error('Wczytywanie geometrii trwa zbyt długo. Sprawdź kompletność plików SVF i ponów otwarcie widoku.'));
      }, 90000);
      viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, event => {
        clearTimeout(timeout);
        if (loadId !== this.loadId) return;
        this.ready = true;
        const fragments = event.model.getFragmentList();
        for (const id of fragments?.fragments?.fragId2dbId || []) this.geometryIds.add(id);
        viewer.fitToView();
        this.events.ready(this.geometryIds.size);
        this.loadSources();
        resolve();
      });
      // Local-mode SVF loader applies encodeURI itself and prepends the origin.
      // Supplying an already encoded/root-relative path double-encodes spaces.
      const localPath = decodeURI(view.url).replace(/^\//, '');
      viewer.loadModel(localPath, {}, () => {}, (code, message) => {
        clearTimeout(timeout);
        reject(new Error(`Błąd wczytywania SVF (${code}): ${message || 'brakuje pliku lub format jest nieobsługiwany'}`));
      });
    });
  }

  has(id) { return this.ready && this.geometryIds.has(Number(id)); }
  fit() { if (this.ready) this.viewer.fitToView(); }
  select(id, fit = false) {
    if (!this.has(id)) return false;
    if (this.visibility && !this.visibility.state.allowed(id)) {
      this.events.notice?.('Element należy do ukrytego modelu lub kategorii. Włącz oczko w drzewku Modele.'); return false;
    }
    this.viewer.select([id]);
    if (fit) {
      if (this.visibility) { this.visibility.state.setHidden([id], false); this.visibility.state.isolate(null); this.visibility.apply(); }
      else this.viewer.show([id]);
      this.viewer.fitToView([id]);
    }
    return true;
  }
  isolate(id) {
    if (!this.has(id)) return;
    if (this.visibility) {
      if (!this.visibility.state.allowed(id)) { this.events.notice?.('Włącz model i kategorię tego elementu w drzewku Modele.'); return; }
      this.visibility.state.setHidden([id], false); this.visibility.state.isolate([id]); this.visibility.apply();
    } else this.viewer.isolate([id]);
    this.viewer.fitToView([id]);
  }
  hide(id) { if (this.has(id)) this.viewer.hide([id]); }
  reset() {
    if (!this.ready) return;
    this.visibility?.reset();
    this.viewer.showAll(); this.viewer.clearSelection(); this.viewer.fitToView();
    this.viewer.getExtension('Autodesk.Section')?.deactivate();
  }
  async section() {
    if (!this.ready) return;
    const extension = this.viewer.getExtension('Autodesk.Section') || await this.viewer.loadExtension('Autodesk.Section');
    if (extension.isActive()) extension.deactivate();
    else extension.activate('X');
  }
  async tree() {
    if (!this.ready) return;
    const extension = this.viewer.getExtension('Autodesk.ModelStructure') || await this.viewer.loadExtension('Autodesk.ModelStructure');
    if (extension.isActive()) extension.deactivate();
    else extension.activate();
  }
  async loadSources() {
    const viewer = this.viewer, loadId = this.loadId;
    if (!this.ready || this.sourceLoading) return;
    this.sourceError = ''; this.sourcePanel?.renderModels();
    this.sourceAbort = new AbortController();
    this.sourceLoading = true;
    try {
      if (!this.sourceRequest) throw new Error('Brak bazy właściwości do rozpoznania modeli.');
      const data = await this.sourceRequest([...this.geometryIds], this.sourceAbort.signal);
      if (this.viewer !== viewer || this.loadId !== loadId) return;
      const tree = await new Promise(resolve => viewer.model.getObjectTree(resolve, () => resolve(null)));
      if (this.viewer !== viewer || this.loadId !== loadId) return;
      this.visibility?.dispose();
      this.visibility = new ViewerVisibility(viewer, new VisibilityState(viewerCategories(data, tree)), Autodesk.Viewing, () => this.sourcePanel?.refreshEyes());
    } catch (error) {
      if (this.viewer !== viewer || this.loadId !== loadId || error.name === 'AbortError') return;
      this.sourceError = `Nie udało się rozpoznać modeli: ${error.message}`;
    } finally {
      if (this.viewer === viewer && this.loadId === loadId) {
        this.sourceLoading = false;
        try {
          const extension = viewer.getExtension('Autodesk.ModelStructure') || await viewer.loadExtension('Autodesk.ModelStructure');
          if (this.viewer !== viewer || this.loadId !== loadId) return;
          if (!this.sourcePanel) {
            const visible = extension.isActive();
            this.sourcePanel = createSourceTreePanel(viewer, this); extension.setModelStructurePanel(this.sourcePanel);
            if (visible) extension.activate();
          }
          else this.sourcePanel.renderModels();
        } catch (error) { this.events.notice?.(`Drzewko modeli jest niedostępne: ${error.message}`); }
      }
    }
  }
  clearSources() {
    this.sourceAbort?.abort(); this.visibility?.dispose(); this.visibility = null;
    this.sourcePanel = null; this.sourceLoading = false; this.sourceError = ''; this.sourceRequest = null;
  }
  clear() { this.cancelLoad?.(); this.loadId++; this.clearSources(); this.ready = false; this.geometryIds.clear(); this.viewer?.finish(); this.viewer = null; }
}
