const eye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="eye-slash" d="m3 3 18 18"/><path class="eye-partial" d="M12 5v14"/></svg>';
const number = value => value.toLocaleString('pl-PL');

// The SDK continues to render the original category/family/type tree.
export function createSourceTreePanel(viewer, owner) {
  const { ViewerModelStructurePanel, generateDefaultViewerHandlerOptions } = Autodesk.Viewing.Extensions;
  return new class extends ViewerModelStructurePanel {
    constructor() {
      super({ ...generateDefaultViewerHandlerOptions(viewer), defaultTitle: 'Drzewo', localizeTitle: false }, 'Drzewo');
      this.owner = owner; this.activeTab = 'models'; this.eyeRows = [];
      this.container.classList.add('source-browser');
      this.container.style.width = '430px';
      this.container.style.backgroundColor = '#fff';
      this.tabs = document.createElement('div'); this.tabs.className = 'source-tabs'; this.tabs.setAttribute('role', 'tablist'); this.tabs.setAttribute('aria-label', 'Podział drzewa');
      this.tabButtons = new Map();
      for (const [key, name] of [['categories', 'Kategorie'], ['models', 'Modele']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.id = `source-tab-${key}`;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `source-content-${key}`);
        button.addEventListener('click', () => this.switchTab(key));
        button.addEventListener('keydown', event => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); const next = event.key === 'Home' ? 'categories' : event.key === 'End' ? 'models' : key === 'models' ? 'categories' : 'models';
            this.switchTab(next); this.tabButtons.get(next).focus();
          }
        });
        this.tabs.append(button); this.tabButtons.set(key, button);
      }
      this.container.append(this.tabs);
      this.modelsBody = document.createElement('div'); this.modelsBody.className = 'source-models'; this.modelsBody.id = 'source-content-models';
      this.modelsBody.setAttribute('role', 'tabpanel'); this.modelsBody.setAttribute('aria-labelledby', 'source-tab-models');
      this.container.append(this.modelsBody);
      this.scrollContainer.classList.add('source-native-tree'); this.scrollContainer.id = 'source-content-categories';
      this.scrollContainer.setAttribute('role', 'tabpanel'); this.scrollContainer.setAttribute('aria-labelledby', 'source-tab-categories');
      this.searchbox?.container.classList.add('source-native-search');
      this.renderModels(); this.switchTab('models');
    }
    createUI() { super.createUI(); this.setTitle('Drzewo', { localizeTitle: false }); if (this.tabs) this.switchTab(this.activeTab); }
    createTreeUI(model) {
      const created = super.createTreeUI(model);
      if (created) {
        // Customize only this panel's rendering delegate. Native SDK flags on an
        // ancestor do not describe partial hides applied to its geometry children.
        const delegate = this.tree.getDelegate(model.id);
        const update = delegate.updateTreeNodeState.bind(delegate);
        delegate.updateTreeNodeState = (id, element) => {
          update(id, element);
          const adapter = this.owner?.visibility;
          if (!adapter || id <= 0) return;
          const { visible, total } = adapter.state.counts(adapter.expand([id]));
          if (!total) return;
          element.classList.toggle('dim', visible === 0);
          element.classList.toggle('visible', visible > 0);
          element.classList.toggle('source-native-partial', visible > 0 && visible < total);
          element.title = `Widoczne: ${number(visible)} z ${number(total)} obiektów geometrii`;
        };
      }
      return created;
    }
    switchTab(key) {
      this.activeTab = key;
      for (const [name, button] of this.tabButtons) { button.setAttribute('aria-selected', String(name === key)); button.tabIndex = name === key ? 0 : -1; }
      this.modelsBody.hidden = key !== 'models'; this.scrollContainer.hidden = key !== 'categories';
      if (this.searchbox) this.searchbox.container.hidden = key !== 'categories';
      if (key === 'categories' && this.uiCreated) this.sync();
    }
    onEyeIcon(dbId, model) {
      if (this.owner.visibility) this.owner.visibility.toggleNode(dbId);
      else super.onEyeIcon(dbId, model);
    }
    setHidden(nodes, model, hidden) { if (!this.owner?.visibility?.applying) super.setHidden(nodes, model, hidden); }
    setIsolation(isolation) { if (!this.owner?.visibility?.applying) super.setIsolation(isolation); }
    getContentSize() {
      if (this.activeTab === 'models') return { width: 430, height: Math.min(620, (this.modelsBody?.scrollHeight || 120) + 110) };
      return super.getContentSize();
    }
    renderModels() {
      this.eyeRows = []; this.modelsBody.replaceChildren();
      const state = this.owner.visibility?.state;
      if (!state) {
        const message = document.createElement('p'); message.className = 'source-tree-message';
        message.textContent = this.owner.sourceError || 'Rozpoznawanie modeli i kategorii…'; this.modelsBody.append(message);
        if (this.owner.sourceError && this.owner.sourceRequest) {
          const retry = document.createElement('button'); retry.className = 'button source-retry'; retry.textContent = 'Spróbuj ponownie';
          retry.addEventListener('click', () => this.owner.loadSources()); this.modelsBody.append(retry);
        }
        return;
      }
      for (const model of state.models) {
        const details = document.createElement('details'); details.className = 'source-model'; details.dataset.modelKey = model.key; details.open = model.kind === 'host';
        const summary = document.createElement('summary');
        const label = document.createElement('span'); label.className = 'source-name';
        label.textContent = model.kind === 'host' ? `Model główny · ${model.name}` : model.name; label.title = label.textContent;
        const count = document.createElement('span'); count.className = 'source-count';
        const button = this.makeEye(label.textContent, () => { state.toggleModel(model.key); this.owner.visibility.apply(); });
        summary.append(label, count, button); details.append(summary);
        const ids = state.modelIds.get(model.key);
        this.eyeRows.push({ button, count, element: details, model, ids });
        if (!ids.length) {
          const empty = document.createElement('p'); empty.className = 'source-empty'; empty.textContent = 'Brak geometrii w tym widoku'; details.append(empty);
        }
        for (const category of model.categories) {
          const row = document.createElement('div'); row.className = 'source-category'; row.dataset.categoryKey = category.key;
          const name = document.createElement('span'); name.className = 'source-name'; name.textContent = category.name; name.title = category.name;
          const amount = document.createElement('span'); amount.className = 'source-count';
          const toggle = this.makeEye(`${category.name} · ${model.name}`, () => { state.toggleCategory(model.key, category.key); this.owner.visibility.apply(); });
          row.append(name, amount, toggle); details.append(row);
          this.eyeRows.push({ button: toggle, count: amount, element: row, model, category, ids: category.ids });
        }
        this.modelsBody.append(details);
      }
      this.refreshEyes();
    }
    makeEye(label, action) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'source-eye'; button.innerHTML = eye; button.dataset.label = label;
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); });
      return button;
    }
    refreshEyes() {
      const state = this.owner.visibility?.state; if (!state) return;
      for (const row of this.eyeRows) {
        const { visible, total } = state.counts(row.ids);
        const enabled = row.category ? state.categoryEnabled(row.model.key, row.category.key) : !state.disabledModels.has(row.model.key);
        const blocked = row.category ? !state.modelEnabled(row.model.key) : !!row.model.parentKey && !state.modelEnabled(row.model.parentKey);
        const status = !enabled ? 'Ukryty' : blocked ? 'Ukryty przez model nadrzędny' : visible === total ? 'Widoczny' : visible === 0 ? 'Włączony, elementy ukryte' : 'Częściowa widoczność';
        row.button.dataset.state = !enabled ? 'off' : visible === total && !blocked ? 'on' : 'partial';
        row.button.setAttribute('aria-pressed', String(enabled)); row.button.disabled = total === 0;
        row.button.title = total ? `${status} · ${number(visible)} z ${number(total)}. ${enabled ? 'Ukryj' : 'Pokaż'}: ${row.button.dataset.label}` : 'Brak geometrii w tym widoku';
        row.button.setAttribute('aria-label', row.button.title);
        row.count.textContent = total ? `${number(visible)}/${number(total)}` : '0';
        row.element.classList.toggle('source-blocked', blocked);
      }
      this.tree?.updateState();
    }
  }();
}
