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

/**
 * Vista de edición del Bloc de Notas
 */
class ScratchpadView extends View {
  constructor(leaf, app, plugin) {
    super(leaf);
    this.app = app;
    this.plugin = plugin;
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
    this.containerEl.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'indexly-scratchpad-container';

    // 1. Sidebar lateral con lista de notas
    const sidebar = document.createElement('aside');
    sidebar.className = 'scratchpad-sidebar';

    const sidebarHeader = document.createElement('div');
    sidebarHeader.className = 'scratchpad-sidebar-header';
    sidebarHeader.innerHTML = `
      <h3>Notas Rápidas</h3>
      <button type="button" class="scratchpad-new-btn" id="sp-btn-new">+ Nueva</button>
    `;
    sidebar.appendChild(sidebarHeader);

    const notesList = document.createElement('div');
    notesList.className = 'scratchpad-notes-list';
    notesList.id = 'sp-notes-list';
    sidebar.appendChild(notesList);
    root.appendChild(sidebar);

    // 2. Área principal de edición
    const editorArea = document.createElement('main');
    editorArea.className = 'scratchpad-editor-area';

    const editorHeader = document.createElement('div');
    editorHeader.className = 'scratchpad-editor-header';
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
    toolbar.innerHTML = `
      <div class="scratchpad-stats" id="sp-stats">0 palabras • 0 caracteres</div>
      <div class="scratchpad-actions">
        <button type="button" class="scratchpad-btn" id="sp-btn-search">Buscar en IndexLy</button>
        <button type="button" class="scratchpad-btn" id="sp-btn-copy">Copiar Nota</button>
        <button type="button" class="scratchpad-btn danger" id="sp-btn-delete">Eliminar</button>
      </div>
    `;
    editorArea.appendChild(toolbar);
    root.appendChild(editorArea);

    this.containerEl.appendChild(root);

    // Handlers
    sidebarHeader.querySelector('#sp-btn-new').onclick = () => {
      this.plugin.createNote();
      this.refresh();
    };

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
        await this.app.native.clipboard.writeText(active.content);
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
    if (!listEl) return;
    listEl.innerHTML = '';

    const notes = this.plugin.state.notes;
    notes.forEach((note) => {
      const item = document.createElement('div');
      item.className = `scratchpad-note-item ${note.id === this.plugin.state.activeNoteId ? 'active' : ''}`;
      item.innerHTML = `
        <span class="scratchpad-note-title">${note.title || 'Sin título'}</span>
        <div class="scratchpad-note-meta">
          <span>${new Date(note.updatedAt).toLocaleDateString()}</span>
          ${note.tags?.[0] ? `<span class="scratchpad-note-tag">#${note.tags[0]}</span>` : ''}
        </div>
      `;
      item.onclick = () => {
        this.plugin.state.activeNoteId = note.id;
        this.refresh();
      };
      listEl.appendChild(item);
    });
  }

  renderActiveNote() {
    const active = this.plugin.getActiveNote();
    const titleInput = this.containerEl.querySelector('#sp-title');
    const tagsInput = this.containerEl.querySelector('#sp-tags');
    const textarea = this.containerEl.querySelector('#sp-content');

    if (!titleInput || !tagsInput || !textarea) return;

    if (active) {
      titleInput.value = active.title || '';
      tagsInput.value = (active.tags || []).map((t) => `#${t}`).join(', ');
      textarea.value = active.content || '';
      titleInput.disabled = false;
      tagsInput.disabled = false;
      textarea.disabled = false;
    } else {
      titleInput.value = '';
      tagsInput.value = '';
      textarea.value = '';
      titleInput.disabled = true;
      tagsInput.disabled = true;
      textarea.disabled = true;
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

    // 1. Cargar estado persistente de data.json
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
    this.state = Object.assign({}, defaultData, saved || {});
    this.state.settings = Object.assign({}, defaultData.settings, (saved && saved.settings) || {});
    if (!this.state.notes || this.state.notes.length === 0) {
      this.state.notes = defaultData.notes;
      this.state.activeNoteId = defaultData.activeNoteId;
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
          await this.app.native.clipboard.writeText(note.content);
          this.showNotice('Nota copiada al portapapeles');
        } else {
          this.showNotice('No hay ninguna nota activa');
        }
      },
    });

    // 3. Añadir botón en Ribbon
    this.addRibbonIcon('file-text', 'Abrir Bloc de Notas', async () => {
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
      }, 15000)
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

  getActiveNote() {
    return this.state.notes.find((n) => n.id === this.state.activeNoteId) || this.state.notes[0] || null;
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
    this.state.notes.unshift(newNote);
    this.state.activeNoteId = id;
    this.saveNotes();
    return newNote;
  }

  deleteNote(id) {
    this.state.notes = this.state.notes.filter((n) => n.id !== id);
    if (this.state.activeNoteId === id) {
      this.state.activeNoteId = this.state.notes[0]?.id || null;
    }
    this.saveNotes();
  }

  async saveNotes() {
    await this.saveData(this.state);
    this.updateStatusBar();
    this.app.events.emit('scratchpad:changed', { notesCount: this.state.notes.length });
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
