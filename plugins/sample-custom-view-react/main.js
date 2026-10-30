/**
 * @file plugins/sample-custom-view-react/main.js
 * @description Plugin de referencia oficial demostrando registro de Workspace Views personalizadas,
 * manipulación controlada del DOM asignado y suscripción reactiva a eventos del host.
 */

const { Plugin, View, Notice } = require('indexly');

const VIEW_TYPE_ANALYTICS = 'indexly-analytics-view';

/**
 * Clase que implementa la vista personalizada del Workspace extendiendo View.
 */
class AnalyticsView extends View {
  constructor(leaf, app) {
    super(leaf);
    this.app = app;
  }

  getViewType() {
    return VIEW_TYPE_ANALYTICS;
  }

  getDisplayText() {
    return 'Panel de Analíticas';
  }

  getIcon() {
    return 'bar-chart-2';
  }

  /**
   * Hook ejecutado cuando la hoja del workspace se monta en el DOM.
   */
  async onOpen() {
    this.containerEl.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'indexly-analytics-container';

    // Cabecera
    const header = document.createElement('div');
    header.className = 'indexly-analytics-header';
    header.innerHTML = `
      <h2 class="indexly-analytics-title">Métricas de Biblioteca e Índice</h2>
      <span class="indexly-analytics-badge">En vivo</span>
    `;
    root.appendChild(header);

    // Rejilla de métricas
    const grid = document.createElement('div');
    grid.className = 'indexly-analytics-grid';

    const sources = await this.app.library.getSources();
    let totalItems = 0;
    sources.forEach((s) => (totalItems += s.count || 0));

    grid.innerHTML = `
      <div class="indexly-analytics-card">
        <div class="indexly-analytics-card-title">Fuentes Conectadas</div>
        <div class="indexly-analytics-card-value" id="val-sources">${sources.length}</div>
      </div>
      <div class="indexly-analytics-card">
        <div class="indexly-analytics-card-title">Ítems Indexados</div>
        <div class="indexly-analytics-card-value" id="val-items">${totalItems}</div>
      </div>
    `;
    root.appendChild(grid);

    // Acciones interactivas
    const actions = document.createElement('div');
    actions.className = 'indexly-analytics-actions';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'indexly-analytics-btn';
    refreshBtn.textContent = 'Actualizar Métricas';
    refreshBtn.onclick = async () => {
      await this.refresh();
      new Notice('Métricas actualizadas.');
    };
    actions.appendChild(refreshBtn);
    root.appendChild(actions);

    this.containerEl.appendChild(root);
  }

  /**
   * Actualiza los valores en el DOM sin recrear el contenedor.
   */
  async refresh() {
    const sources = await this.app.library.getSources();
    let totalItems = 0;
    sources.forEach((s) => (totalItems += s.count || 0));

    const sEl = this.containerEl.querySelector('#val-sources');
    const iEl = this.containerEl.querySelector('#val-items');
    if (sEl) sEl.textContent = String(sources.length);
    if (iEl) iEl.textContent = String(totalItems);
  }

  /**
   * Hook ejecutado cuando la hoja del workspace se cierra o destruye.
   */
  async onClose() {
    this.containerEl.innerHTML = '';
  }
}

module.exports = class CustomViewPlugin extends Plugin {
  async onload() {
    console.log(`[CustomViewPlugin] Inicializando vista personalizada '${VIEW_TYPE_ANALYTICS}'`);

    // 1. Registrar el tipo de vista en el Workspace del host
    this.registerView(VIEW_TYPE_ANALYTICS, (leaf) => new AnalyticsView(leaf, this.app));

    // 2. Registrar comando para abrir o revelar la vista
    this.addCommand({
      id: 'open-analytics-view',
      name: 'Abrir panel de analíticas de la biblioteca',
      callback: async () => {
        let leaf = this.app.workspace.getLeaf(VIEW_TYPE_ANALYTICS);
        if (leaf && leaf.view && typeof leaf.view.onOpen === 'function') {
          await leaf.view.onOpen();
        }
        this.app.workspace.revealLeaf(leaf);
      },
    });

    // 3. Suscribirse a eventos de la biblioteca de forma reactiva
    this.registerEvent(
      this.app.library.on('source:added', () => {
        const leaf = this.app.workspace.getLeaf(VIEW_TYPE_ANALYTICS);
        if (leaf && leaf.view && typeof leaf.view.refresh === 'function') {
          leaf.view.refresh();
        }
      })
    );
  }

  async onunload() {
    console.log(`[CustomViewPlugin] Descargando y desacoplando hojas de analíticas`);
  }
};
