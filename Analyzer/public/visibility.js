// Use the category branches actually displayed by the native viewer. A nested
// generic component of a window belongs to the Windows branch in this view.
export function viewerCategories(data, tree) {
  if (!tree) return data;
  const root = tree.getRootId(), branches = new Map();
  const branch = id => {
    if (branches.has(id)) return branches.get(id);
    const visited = new Set(); const path = []; let node = id;
    while (node && node !== root && !visited.has(node)) {
      if (branches.has(node)) { node = branches.get(node); break; }
      visited.add(node); path.push(node);
      const parent = tree.getNodeParentId(node);
      if (parent === root) break;
      if (!parent) { node = null; break; }
      node = parent;
    }
    if (node === root || visited.has(node) && tree.getNodeParentId(node) !== root) node = null;
    for (const item of path) branches.set(item, node);
    return node;
  };
  return { ...data, models: data.models.map(model => {
    const groups = new Map();
    for (const category of model.categories) for (const id of category.ids) {
      const node = branch(id); const key = node ? `tree:${node}` : category.key;
      if (!groups.has(key)) groups.set(key, { key, name: node ? tree.getNodeName(node) : category.name, ids: [] });
      groups.get(key).ids.push(id);
    }
    return { ...model, categories: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true })) };
  }) };
}

// Geometry-only visibility. Parent switches never overwrite child preferences.
export class VisibilityState {
  constructor({ models }) {
    this.models = models;
    this.byModel = new Map(models.map(model => [model.key, model]));
    this.ancestors = new Map();
    this.membership = new Map();
    this.modelIds = new Map();
    this.disabledModels = new Set();
    this.disabledCategories = new Set();
    this.hidden = new Set();
    this.isolated = null;
    for (const model of models) {
      const ancestors = [], seen = new Set(); let key = model.key;
      while (key && this.byModel.has(key) && !seen.has(key)) {
        seen.add(key); ancestors.push(key); key = this.byModel.get(key).parentKey;
      }
      this.ancestors.set(model.key, ancestors);
      const ids = [];
      for (const category of model.categories) {
        const token = this.categoryToken(model.key, category.key);
        for (const id of category.ids) {
          if (this.membership.has(id)) throw new Error('Element przypisany do więcej niż jednego modelu.');
          this.membership.set(id, { modelKey: model.key, categoryKey: category.key, token });
          ids.push(id);
        }
      }
      this.modelIds.set(model.key, ids);
    }
    // A parent link switch also controls nested placements, without duplicating membership.
    for (const model of models) {
      const own = model.categories.flatMap(category => category.ids);
      const seen = new Set([model.key]);
      let parent = model.parentKey;
      while (parent && this.byModel.has(parent) && !seen.has(parent)) {
        seen.add(parent); for (const id of own) this.modelIds.get(parent).push(id); parent = this.byModel.get(parent).parentKey;
      }
    }
  }
  categoryToken(modelKey, categoryKey) { return JSON.stringify([modelKey, categoryKey]); }
  modelEnabled(key) {
    return (this.ancestors.get(key) || []).every(parent => !this.disabledModels.has(parent));
  }
  categoryEnabled(modelKey, categoryKey) { return !this.disabledCategories.has(this.categoryToken(modelKey, categoryKey)); }
  allowed(id) {
    const item = this.membership.get(id);
    return !!item && this.modelEnabled(item.modelKey) && !this.disabledCategories.has(item.token);
  }
  visible(id) { return this.allowed(id) && !this.hidden.has(id) && (!this.isolated || this.isolated.has(id)); }
  toggleModel(key) { if (this.disabledModels.has(key)) this.disabledModels.delete(key); else this.disabledModels.add(key); }
  toggleCategory(modelKey, categoryKey) {
    const token = this.categoryToken(modelKey, categoryKey);
    if (this.disabledCategories.has(token)) this.disabledCategories.delete(token); else this.disabledCategories.add(token);
  }
  setGlobalCategory(categoryKey, visible) {
    for (const model of this.models) for (const category of model.categories) if (category.key === categoryKey) {
      const token = this.categoryToken(model.key, categoryKey);
      if (visible) this.disabledCategories.delete(token); else this.disabledCategories.add(token);
    }
  }
  setHidden(ids, hidden) { for (const id of ids) { if (hidden) this.hidden.add(id); else this.hidden.delete(id); } }
  isolate(ids) { this.isolated = ids == null ? null : new Set(ids); }
  reset() { this.disabledModels.clear(); this.disabledCategories.clear(); this.hidden.clear(); this.isolated = null; }
  counts(ids) { let visible = 0; for (const id of ids) if (this.visible(id)) visible++; return { visible, total: ids.length }; }
}

export class ViewerVisibility {
  constructor(viewer, state, events, changed) {
    this.viewer = viewer; this.state = state; this.changed = changed;
    this.applying = false; this.disposed = false; this.pending = false; this.appliedHidden = new Set(); this.listeners = [];
    this.nodeCache = new Map(); this.categoryNodes = new Map();
    const tree = viewer.model.getInstanceTree(), depths = new Map(), layers = new Map();
    for (const id of state.membership.keys()) {
      let node = id, depth = 0; const path = [], seen = new Set();
      while (node && !seen.has(node)) {
        if (depths.has(node)) { depth = depths.get(node) + 1; break; }
        seen.add(node); path.push(node); node = tree?.getNodeParentId(node);
      }
      for (let i = path.length - 1; i >= 0; i--) depths.set(path[i], depth++);
      const level = depths.get(id) || 0;
      if (!layers.has(level)) layers.set(level, []); layers.get(level).push(id);
    }
    this.layers = [...layers].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
    const listen = (name, callback) => { viewer.addEventListener(name, callback); this.listeners.push([name, callback]); };
    const external = action => event => {
      if (this.applying || this.disposed || (event.model && event.model !== viewer.model)) return;
      action(event); this.schedule();
    };
    listen(events.HIDE_EVENT, external(event => this.setNodes(event.nodeIdArray, false)));
    listen(events.SHOW_EVENT, external(event => this.setNodes(event.nodeIdArray, true)));
    listen(events.ISOLATE_EVENT, external(event => state.isolate(event.nodeIdArray?.length ? this.expand(event.nodeIdArray) : null)));
    listen(events.SHOW_ALL_EVENT, external(() => state.reset()));
    // Preserve any interaction that happened while the source index was loading.
    for (const id of state.membership.keys()) if (!viewer.isNodeVisible(id)) state.hidden.add(id);
    this.apply(true);
  }
  expand(nodes) {
    const ids = new Set(); const tree = this.viewer.model.getInstanceTree();
    for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
      if (!Number.isInteger(node)) continue;
      let members = this.nodeCache.get(node);
      if (!members) {
        const found = new Set();
        if (this.state.membership.has(node)) found.add(node);
        tree?.enumNodeChildren(node, id => { if (this.state.membership.has(id)) found.add(id); }, true);
        members = [...found]; this.nodeCache.set(node, members);
        if (tree?.getNodeParentId(node) === tree.getRootId() && members.length) {
          const key = this.state.membership.get(members[0]).categoryKey;
          if (members.every(id => this.state.membership.get(id).categoryKey === key)) this.categoryNodes.set(node, key);
        }
      }
      for (const id of members) ids.add(id);
    }
    return [...ids];
  }
  setNodes(nodes, visible) {
    for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
      const ids = this.expand([node]); const categoryKey = this.categoryNodes.get(node);
      if (categoryKey) {
        this.state.setGlobalCategory(categoryKey, visible);
        if (visible) this.state.setHidden(ids, false);
      }
      else this.state.setHidden(ids, !visible);
    }
  }
  toggleNode(node) {
    const ids = this.expand([node]);
    const visible = !ids.some(id => this.state.visible(id));
    this.setNodes([node], visible); this.apply();
  }
  schedule() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; if (!this.disposed) this.apply(true); });
  }
  apply(normalize = false) {
    if (this.disposed) return;
    const hidden = new Set(); const hide = [], show = [];
    for (const id of this.state.membership.keys()) {
      if (!this.state.visible(id)) { hidden.add(id); if (normalize || !this.appliedHidden.has(id)) hide.push(id); }
      else if (this.appliedHidden.has(id)) show.push(id);
    }
    this.applying = true;
    try {
      // Normalize native ancestor hiding/isolation before applying our geometry masks.
      if (normalize) this.viewer.showAll();
      else if (show.length) this.viewer.show(show);
      if (hide.length) this.viewer.hide(hide);
      // Public hide/show recurse into children. Restore finer overrides in
      // parent-before-child order, including children affected by a parent show.
      for (const layer of this.layers) {
        const repairShow = [], repairHide = [];
        for (const id of layer) {
          const visible = this.viewer.isNodeVisible(id);
          if (hidden.has(id) && visible) repairHide.push(id);
          else if (!hidden.has(id) && !visible) repairShow.push(id);
        }
        if (repairShow.length) this.viewer.show(repairShow);
        if (repairHide.length) this.viewer.hide(repairHide);
      }
      const selected = this.viewer.getSelection();
      const retained = selected.filter(id => !this.expand([id]).some(child => hidden.has(child)));
      if (retained.length !== selected.length) this.viewer.select(retained);
      this.appliedHidden = hidden;
    } finally { this.applying = false; }
    this.changed?.();
  }
  reset() { this.state.reset(); this.apply(true); }
  dispose() { this.disposed = true; for (const [name, callback] of this.listeners) this.viewer.removeEventListener(name, callback); this.nodeCache.clear(); }
}
