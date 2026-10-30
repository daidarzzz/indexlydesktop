/**
 * @file plugins/sample-scratchpad-notes/main.js
 * @description Plugin oficial de Bloc de Notas Rápido para IndexLy Desktop v2.0.
 * Demuestra:
 * - Ciclo de vida y persistencia en almacenamiento aislado (loadData / saveData)
 * - Vistas de espacio de trabajo personalizadas (registerView / WorkspaceLeaf / View)
 * - Paleta de comandos y atajos de teclado (addCommand)
 * - Integración con portapapeles nativo (app.native.clipboard)
 * - Pestaña de configuración fluida (PluginSettingTab / Setting)
 * - Notificaciones no intrusivas (Notice) y barra de estado reactiva (addStatusBarItem)
 */

const { Plugin, View, Notice, PluginSettingTab, Setting } = require('indexly');

const VIEW_TYPE_SCRATCHPAD = 'indexly-scratchpad-view';

const EMBEDDED_THEME_CSS = `
.indexly-scratchpad-container {
  display: flex;
  height: 600px;
  max-height: 80vh;
  background: #080c15;
  border: 1px solid #1c2638;
  border-radius: 12px;
  overflow: hidden;
  color: #f8fafc;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
}
.scratchpad-sidebar {
  width: 280px;
  border-right: 1px solid #1a2333;
  background: #0c101b;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.scratchpad-sidebar-header {
  padding: 14px 16px;
  border-bottom: 1px solid #1a2333;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #0e1422;
}
.scratchpad-header-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.scratchpad-header-title-wrap h3 {
  font-size: 13.5px;
  font-weight: 600;
  margin: 0;
  color: #f8fafc;
}
.scratchpad-badge {
  font-size: 10px;
  font-family: monospace;
  background: rgba(14, 165, 233, 0.12);
  color: #38bdf8;
  border: 1px solid rgba(14, 165, 233, 0.25);
  border-radius: 10px;
  padding: 1px 6px;
}
.scratchpad-new-btn {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 5px 12px;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(14, 165, 233, 0.25);
  transition: all 0.15s ease;
}
.scratchpad-new-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(14, 165, 233, 0.4);
}
.scratchpad-sidebar-filter {
  padding: 8px 12px;
  border-bottom: 1px solid #161f2e;
}
.scratchpad-filter-input {
  width: 100%;
  background: #111726;
  border: 1px solid #1e293b;
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 12px;
  padding: 6px 10px;
  outline: none;
  box-sizing: border-box;
}
.scratchpad-filter-input:focus {
  border-color: #0ea5e9;
}
.scratchpad-notes-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.scratchpad-note-item {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: #111624;
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.12s ease;
  position: relative;
}
.scratchpad-note-item:hover {
  background: #171f32;
  border-color: #243048;
}
.scratchpad-note-item.active {
  background: #152238;
  border-color: rgba(14, 165, 233, 0.4);
  border-left: 3px solid #0ea5e9;
}
.scratchpad-note-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.scratchpad-note-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #f8fafc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.scratchpad-note-del-btn {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1;
  opacity: 0.5;
  transition: all 0.12s ease;
}
.scratchpad-note-item:hover .scratchpad-note-del-btn {
  opacity: 1;
}
.scratchpad-note-del-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}
.scratchpad-note-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10.5px;
  color: #64748b;
  font-family: monospace;
}
.scratchpad-note-tag {
  background: rgba(14, 165, 233, 0.12);
  color: #38bdf8;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
}
.scratchpad-note-snippet {
  font-size: 11px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}
.scratchpad-empty-list {
  padding: 32px 12px;
  text-align: center;
  color: #64748b;
  font-size: 12px;
}
.scratchpad-editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #080c15;
}
.scratchpad-editor-header {
  padding: 16px 24px;
  border-bottom: 1px solid #1a2333;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #090e18;
}
.scratchpad-title-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  font-family: inherit;
  letter-spacing: -0.01em;
  padding: 0;
  box-sizing: border-box;
}
.scratchpad-title-input::placeholder {
  color: #334155;
}
.scratchpad-tags-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-size: 11.5px;
  color: #38bdf8;
  font-family: monospace;
  padding: 0;
  box-sizing: border-box;
}
.scratchpad-tags-input::placeholder {
  color: #475569;
}
.scratchpad-textarea {
  flex: 1;
  width: 100%;
  padding: 20px 24px;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  color: #cbd5e1;
  font-family: monospace;
  font-size: 13.5px;
  line-height: 1.7;
  box-sizing: border-box;
}
.scratchpad-textarea::placeholder {
  color: #334155;
}
.scratchpad-toolbar {
  padding: 10px 20px;
  border-top: 1px solid #1a2333;
  background: #0a0f1b;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.scratchpad-stats {
  font-size: 11px;
  color: #64748b;
  font-family: monospace;
  display: flex;
  align-items: center;
  gap: 12px;
}
.scratchpad-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.scratchpad-btn {
  background: #111726;
  border: 1px solid #1e293b;
  color: #cbd5e1;
  font-size: 11.5px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.scratchpad-btn:hover {
  background: #1a233a;
  border-color: #334155;
  color: #ffffff;
}
.scratchpad-btn.danger {
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.08);
}
.scratchpad-btn.danger:hover {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.45);
  color: #fca5a5;
}
.scratchpad-empty-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  color: #64748b;
}
.scratchpad-empty-icon {
  font-size: 36px;
  margin-bottom: 12px;
}
.scratchpad-empty-editor h3 {
  font-size: 15px;
  font-weight: 600;
  color: #f8fafc;
  margin-bottom: 6px;
}
.scratchpad-empty-editor p {
  font-size: 12.5px;
  color: #94a3b8;
  max-width: 340px;
  margin-bottom: 20px;
}
.scratchpad-create-first-btn {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  padding: 8px 18px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(14, 165, 233, 0.3);
  transition: all 0.15s ease;
}
.scratchpad-create-first-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(14, 165, 233, 0.45);
}
`;

/**
 * Vista de edición del Bloc de Notas
 */
class ScratchpadView extends View {
  constructor(leaf, app, plugin) {
    super(leaf);
    this.app = app;
    this.plugin = plugin;
    this.filterText = '';
  }

  getViewType() {
    return VIEW_TYPE_SCRATCHPAD;
  }

  getDisplayText() {
    return 'Bloc de Notas';
  }

  getIcon() {
    return 'file-text';
  }

  async onOpen() {
    // Inyectar estilos embebidos seguros si no estuviesen activos
    if (typeof document !== 'undefined' && !document.getElementById('scratchpad-embedded-theme')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'scratchpad-embedded-theme';
      styleEl.textContent = EMBEDDED_THEME_CSS;
      document.head.appendChild(styleEl);
    }

    this.containerEl.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'indexly-scratchpad-container';

    // 1. Sidebar lateral con lista de notas y buscador
    const sidebar = document.createElement('aside');
    sidebar.className = 'scratchpad-sidebar';

    const sidebarHeader = document.createElement('div');
    sidebarHeader.className = 'scratchpad-sidebar-header';
    sidebarHeader.innerHTML = `
      <div class="scratchpad-header-title-wrap">
        <h3>Notas Rápidas</h3>
        <span class="scratchpad-badge" id="sp-count-badge">0</span>
      </div>
      <button type="button" class="scratchpad-new-btn" id="sp-btn-new">+ Nueva</button>
    `;
    sidebar.appendChild(sidebarHeader);

    const filterWrap = document.createElement('div');
    filterWrap.className = 'scratchpad-sidebar-filter';
    filterWrap.innerHTML = `
      <input type="text" class="scratchpad-filter-input" id="sp-filter" placeholder="🔍 Filtrar notas..." />
    `;
    sidebar.appendChild(filterWrap);

    const notesList = document.createElement('div');
    notesList.className = 'scratchpad-notes-list';
    notesList.id = 'sp-notes-list';
    sidebar.appendChild(notesList);
    root.appendChild(sidebar);

    // 2. Área principal de edición
    const editorArea = document.createElement('main');
    editorArea.className = 'scratchpad-editor-area';
    editorArea.id = 'sp-editor-area';

    const editorHeader = document.createElement('div');
    editorHeader.className = 'scratchpad-editor-header';
    editorHeader.id = 'sp-editor-header';
    editorHeader.innerHTML = `
      <input type="text" class="scratchpad-title-input" id="sp-title" placeholder="Título de la nota..." />
      <input type="text" class="scratchpad-tags-input" id="sp-tags" placeholder="#etiquetas separadas por comas" />
    `;
    editorArea.appendChild(editorHeader);

    const textarea = document.createElement('textarea');
    textarea.className = 'scratchpad-textarea';
    textarea.id = 'sp-content';
    textarea.placeholder = 'Escribe tus notas, fragmentos o ideas en Markdown...';
    editorArea.appendChild(textarea);

    const toolbar = document.createElement('footer');
    toolbar.className = 'scratchpad-toolbar';
    toolbar.id = 'sp-editor-toolbar';
    toolbar.innerHTML = `
      <div class="scratchpad-stats" id="sp-stats">0 palabras • 0 caracteres</div>
      <div class="scratchpad-actions">
        <button type="button" class="scratchpad-btn" id="sp-btn-search">Buscar en IndexLy</button>
        <button type="button" class="scratchpad-btn" id="sp-btn-copy">Copiar Nota</button>
        <button type="button" class="scratchpad-btn danger" id="sp-btn-delete">Eliminar</button>
      </div>
    `;
    editorArea.appendChild(toolbar);

    // Contenedor de estado vacío cuando no hay notas seleccionadas
    const emptyState = document.createElement('div');
    emptyState.className = 'scratchpad-empty-editor';
    emptyState.id = 'sp-empty-editor';
    emptyState.style.display = 'none';
    emptyState.innerHTML = `
      <div class="scratchpad-empty-icon">📝</div>
      <h3>Ninguna nota seleccionada</h3>
      <p>Crea una nueva nota rápida o selecciona una de la barra lateral para empezar.</p>
      <button type="button" class="scratchpad-create-first-btn" id="sp-btn-create-empty">+ Crear nueva nota</button>
    `;
    editorArea.appendChild(emptyState);

    root.appendChild(editorArea);
    this.containerEl.appendChild(root);

    // Eventos del Sidebar
    sidebarHeader.querySelector('#sp-btn-new').onclick = () => {
      this.plugin.createNote();
      this.refresh();
      const titleInput = this.containerEl.querySelector('#sp-title');
      if (titleInput) titleInput.focus();
    };

    const filterInput = filterWrap.querySelector('#sp-filter');
    filterInput.oninput = (e) => {
      this.filterText = (e.target.value || '').toLowerCase();
      this.renderList();
    };

    // Eventos del Editor
    const titleInput = editorHeader.querySelector('#sp-title');
    const tagsInput = editorHeader.querySelector('#sp-tags');

    titleInput.oninput = (e) => {
      const active = this.plugin.getActiveNote();
      if (active) {
        active.title = e.target.value;
        active.updatedAt = new Date().toISOString();
        this.plugin.saveNotes();
        this.renderList();
      }
    };

    tagsInput.oninput = (e) => {
      const active = this.plugin.getActiveNote();
      if (active) {
        active.tags = e.target.value
          .split(',')
          .map((t) => t.trim().replace(/^#/, ''))
          .filter(Boolean);
        active.updatedAt = new Date().toISOString();
        this.plugin.saveNotes();
      }
    };

    textarea.oninput = (e) => {
      const active = this.plugin.getActiveNote();
      if (active) {
        active.content = e.target.value;
        active.updatedAt = new Date().toISOString();
        this.plugin.saveNotes();
        this.updateStats();
      }
    };

    toolbar.querySelector('#sp-btn-copy').onclick = async () => {
      const active = this.plugin.getActiveNote();
      if (active) {
        await this.app.native.clipboard.writeText(active.content || '');
        this.plugin.showNotice('Nota copiada al portapapeles');
      }
    };

    toolbar.querySelector('#sp-btn-search').onclick = async () => {
      const active = this.plugin.getActiveNote();
      if (active && active.title) {
        this.plugin.showNotice(`Buscando «${active.title}» en IndexLy...`);
        try {
          await this.app.search.query(active.title, { limit: 10 });
        } catch {
          // Ignorado si la búsqueda falla
        }
      }
    };

    toolbar.querySelector('#sp-btn-delete').onclick = () => {
      const active = this.plugin.getActiveNote();
      if (active) {
        this.plugin.deleteNote(active.id);
        this.refresh();
        this.plugin.showNotice('Nota eliminada');
      }
    };

    emptyState.querySelector('#sp-btn-create-empty').onclick = () => {
      this.plugin.createNote();
      this.refresh();
      const tInput = this.containerEl.querySelector('#sp-title');
      if (tInput) tInput.focus();
    };

    this.refresh();
  }

  async onClose() {
    this.containerEl.innerHTML = '';
  }

  refresh() {
    this.renderList();
    this.renderActiveNote();
    this.updateStats();
  }

  renderList() {
    const listEl = this.containerEl.querySelector('#sp-notes-list');
    const badgeEl = this.containerEl.querySelector('#sp-count-badge');
    if (!listEl) return;
    listEl.innerHTML = '';

    const allNotes = this.plugin.state.notes || [];
    if (badgeEl) {
      badgeEl.textContent = String(allNotes.length);
    }

    const filteredNotes = allNotes.filter((n) => {
      if (!this.filterText) return true;
      const titleMatch = (n.title || '').toLowerCase().includes(this.filterText);
      const contentMatch = (n.content || '').toLowerCase().includes(this.filterText);
      const tagMatch = (n.tags || []).some((t) => t.toLowerCase().includes(this.filterText));
      return titleMatch || contentMatch || tagMatch;
    });

    if (filteredNotes.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'scratchpad-empty-list';
      emptyDiv.textContent = this.filterText ? 'Sin coincidencias' : 'No hay notas aún';
      listEl.appendChild(emptyDiv);
      return;
    }

    filteredNotes.forEach((note) => {
      const isActive = note.id === this.plugin.state.activeNoteId;
      const item = document.createElement('div');
      item.className = `scratchpad-note-item ${isActive ? 'active' : ''}`;

      const snippet = (note.content || 'Sin contenido...')
        .replace(/\n+/g, ' ')
        .substring(0, 48);

      item.innerHTML = `
        <div class="scratchpad-note-header-row">
          <span class="scratchpad-note-title">${note.title || 'Sin título'}</span>
          <button type="button" class="scratchpad-note-del-btn" title="Eliminar esta nota" aria-label="Eliminar nota">✕</button>
        </div>
        <div class="scratchpad-note-snippet">${snippet}</div>
        <div class="scratchpad-note-meta">
          <span>${new Date(note.updatedAt || Date.now()).toLocaleDateString()}</span>
          ${note.tags?.[0] ? `<span class="scratchpad-note-tag">#${note.tags[0]}</span>` : ''}
        </div>
      `;

      item.onclick = () => {
        this.plugin.state.activeNoteId = note.id;
        this.refresh();
      };

      const delBtn = item.querySelector('.scratchpad-note-del-btn');
      if (delBtn) {
        delBtn.onclick = (e) => {
          e.stopPropagation();
          this.plugin.deleteNote(note.id);
          this.refresh();
          this.plugin.showNotice('Nota eliminada');
        };
      }

      listEl.appendChild(item);
    });
  }

  renderActiveNote() {
    const active = this.plugin.getActiveNote();
    const titleInput = this.containerEl.querySelector('#sp-title');
    const tagsInput = this.containerEl.querySelector('#sp-tags');
    const textarea = this.containerEl.querySelector('#sp-content');
    const editorHeader = this.containerEl.querySelector('#sp-editor-header');
    const toolbar = this.containerEl.querySelector('#sp-editor-toolbar');
    const emptyState = this.containerEl.querySelector('#sp-empty-editor');

    if (!titleInput || !tagsInput || !textarea) return;

    if (active) {
      if (editorHeader) editorHeader.style.display = 'flex';
      textarea.style.display = 'block';
      if (toolbar) toolbar.style.display = 'flex';
      if (emptyState) emptyState.style.display = 'none';

      titleInput.value = active.title || '';
      tagsInput.value = (active.tags || []).map((t) => `#${t}`).join(', ');
      textarea.value = active.content || '';
    } else {
      if (editorHeader) editorHeader.style.display = 'none';
      textarea.style.display = 'none';
      if (toolbar) toolbar.style.display = 'none';
      if (emptyState) emptyState.style.display = 'flex';
    }
  }

  updateStats() {
    const statsEl = this.containerEl.querySelector('#sp-stats');
    if (!statsEl) return;
    const active = this.plugin.getActiveNote();
    if (!active || !active.content) {
      statsEl.textContent = '0 palabras • 0 caracteres';
      return;
    }
    const words = active.content.trim().split(/\s+/).filter(Boolean).length;
    const chars = active.content.length;
    statsEl.textContent = `${words} palabras • ${chars} caracteres`;
  }
}

/**
 * Pestaña de Ajustes del Plugin
 */
class ScratchpadSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Autoguardado continuo')
      .setDesc('Persistir los cambios en disco atómicamente a medida que escribes')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.state.settings.autoSave)
          .onChange(async (val) => {
            this.plugin.state.settings.autoSave = val;
            await this.plugin.saveNotes();
          })
      );

    new Setting(containerEl)
      .setName('Mostrar contador en barra de estado')
      .setDesc('Exhibe el número total de notas y palabras en el pie de IndexLy')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.state.settings.wordCountInStatus)
          .onChange(async (val) => {
            this.plugin.state.settings.wordCountInStatus = val;
            this.plugin.updateStatusBar();
            await this.plugin.saveNotes();
          })
      );

    new Setting(containerEl)
      .setName('Etiqueta predeterminada')
      .setDesc('Etiqueta asignada por defecto a las nuevas notas creadas')
      .addText((text) =>
        text
          .setPlaceholder('ej. ideas, proyecto')
          .setValue(this.plugin.state.settings.defaultTag)
          .onChange(async (val) => {
            this.plugin.state.settings.defaultTag = val.trim() || 'general';
            await this.plugin.saveNotes();
          })
      );
  }
}

/**
 * Plugin Principal
 */
module.exports = class ScratchpadNotesPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.notices = [];
  }

  showNotice(msg, duration) {
    const notice = new Notice(msg, duration);
    this.notices.push(notice);
    return notice;
  }

  async onload() {
    console.log(`[ScratchpadPlugin] Inicializando '${this.manifest.name}' v${this.manifest.version}`);

    const defaultData = {
      notes: [
        {
          id: 'note-welcome',
          title: 'Bienvenido al Bloc de Notas de IndexLy',
          content: '# Bloc de Notas Rápido\n\nEste plugin demuestra el poder de la API v1 de IndexLy:\n- Persistencia atómica aislada en data.json\n- Atajo global `Mod+Shift+N`\n- Copiado instantáneo al portapapeles\n- Búsqueda integrada',
          tags: ['bienvenida', 'tutorial'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      activeNoteId: 'note-welcome',
      settings: {
        autoSave: true,
        wordCountInStatus: true,
        defaultTag: 'general',
      },
    };

    const saved = await this.loadData();
    if (saved && typeof saved === 'object') {
      this.state = Object.assign({}, defaultData, saved);
      this.state.settings = Object.assign({}, defaultData.settings, saved.settings || {});
      if (!Array.isArray(this.state.notes)) {
        this.state.notes = defaultData.notes;
        this.state.activeNoteId = defaultData.activeNoteId;
      }
    } else {
      this.state = Object.assign({}, defaultData);
    }

    // 2. Registrar comandos
    this.addCommand({
      id: 'open-scratchpad',
      name: 'Abrir Bloc de Notas Rápido',
      shortcut: 'Mod+Shift+N',
      callback: async () => {
        await this.openView();
      },
    });

    this.addCommand({
      id: 'new-note',
      name: 'Crear nueva nota rápida',
      callback: async () => {
        this.createNote();
        await this.openView();
        this.showNotice('Nueva nota creada');
      },
    });

    this.addCommand({
      id: 'copy-active-note',
      name: 'Copiar contenido de la nota activa al portapapeles',
      callback: async () => {
        const note = this.getActiveNote();
        if (note) {
          await this.app.native.clipboard.writeText(note.content || '');
          this.showNotice('Nota copiada al portapapeles');
        } else {
          this.showNotice('No hay ninguna nota activa');
        }
      },
    });

    // 3. Añadir botón en Ribbon (deduplicado automáticamente)
    this.addRibbonIcon('edit-3', 'Abrir Bloc de Notas', async () => {
      await this.openView();
    });

    // 4. Añadir contador en la barra de estado
    this.statusEl = this.addStatusBarItem();
    this.updateStatusBar();

    // 5. Registrar Vista Personalizada en el Workspace
    this.registerView(VIEW_TYPE_SCRATCHPAD, (leaf) => new ScratchpadView(leaf, this.app, this));

    // 6. Registrar Pestaña de Ajustes
    this.addSettingTab(new ScratchpadSettingTab(this.app, this));

    // 7. Intervalo de actualización periódica
    this.registerInterval(
      window.setInterval(() => {
        this.updateStatusBar();
      }, 30000)
    );
  }

  async openView() {
    let leaf = this.app.workspace.getLeaf(VIEW_TYPE_SCRATCHPAD);
    if (!leaf) {
      const leaves = this.app.workspace.getLeaves();
      leaf = leaves[0] || null;
    }
    if (leaf) {
      this.app.workspace.revealLeaf(leaf);
      if (leaf.view && typeof leaf.view.refresh === 'function') {
        leaf.view.refresh();
      }
    }
  }

  async activateView() {
    await this.openView();
  }

  getActiveNote() {
    const notes = this.state.notes || [];
    return notes.find((n) => n.id === this.state.activeNoteId) || notes[0] || null;
  }

  createNote() {
    const id = `note-${Date.now()}`;
    const newNote = {
      id,
      title: 'Nueva nota',
      content: '',
      tags: [this.state.settings.defaultTag || 'general'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!this.state.notes) this.state.notes = [];
    this.state.notes.unshift(newNote);
    this.state.activeNoteId = id;
    this.saveNotes();
    return newNote;
  }

  deleteNote(id) {
    this.state.notes = (this.state.notes || []).filter((n) => n.id !== id);
    if (this.state.activeNoteId === id) {
      this.state.activeNoteId = this.state.notes[0]?.id || null;
    }
    this.saveNotes();
  }

  async saveNotes() {
    await this.saveData(this.state);
    this.updateStatusBar();
    this.app.events.emit('scratchpad:changed', { notesCount: (this.state.notes || []).length });
  }

  updateStatusBar() {
    if (!this.statusEl) return;
    const settings = (this.state && this.state.settings) || {};
    if (settings.wordCountInStatus === false) {
      this.statusEl.textContent = '';
      return;
    }
    const notes = (this.state && this.state.notes) || [];
    const count = notes.length;
    let totalWords = 0;
    notes.forEach((n) => {
      totalWords += (n.content || '').trim().split(/\s+/).filter(Boolean).length;
    });
    this.statusEl.textContent = `Notas: ${count} (${totalWords} palabras)`;
    this.statusEl.title = 'IndexLy Scratchpad activo';
  }

  async onunload() {
    console.log(`[ScratchpadPlugin] Descargando y desacoplando vistas del Bloc de Notas`);
    const embeddedStyle = document.getElementById('scratchpad-embedded-theme');
    if (embeddedStyle) {
      embeddedStyle.remove();
    }
    if (Array.isArray(this.notices)) {
      this.notices.forEach((n) => {
        if (n && typeof n.hide === 'function') {
          n.hide();
        }
      });
      this.notices = [];
    }
    const container = document.querySelector('.indexly-notice-container');
    if (container && container.childNodes.length === 0) {
      container.remove();
    }
    const leaf = this.app.workspace.getLeaf(VIEW_TYPE_SCRATCHPAD);
    if (leaf && leaf.view && typeof leaf.view.onClose === 'function') {
      await leaf.view.onClose();
    }
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SCRATCHPAD);
  }
};
