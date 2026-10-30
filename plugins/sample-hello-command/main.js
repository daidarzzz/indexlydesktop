/**
 * @file plugins/sample-hello-command/main.js
 * @description Plugin de referencia oficial para la API v1 de IndexLy Desktop.
 * Demuestra:
 * - Ciclo de vida estricto (onload / onunload)
 * - Registro reversible de comandos en la paleta (addCommand)
 * - Interfaz gráfica reactiva (Notice, Ribbon Icon, Status Bar)
 * - Temporizadores con autolimpieza (registerInterval)
 * - Persistencia atómica de estado en disco (loadData / saveData)
 */

const { Plugin, Notice } = require('indexly');

module.exports = class HelloCommandPlugin extends Plugin {
  /**
   * Hook de inicialización del plugin.
   * Se ejecuta de forma asíncrona tras la inyección del entorno `app`.
   */
  async onload() {
    console.log(`[HelloCommandPlugin] Inicializando '${this.manifest.name}' v${this.manifest.version}`);

    // 1. Cargar datos persistentes del plugin (almacenados en data.json)
    const state = (await this.loadData()) || { greetingsCount: 0, lastGreeted: null };

    // 2. Registrar comando en la paleta de comandos de IndexLy
    this.addCommand({
      id: 'greet-user',
      name: 'Saludar al usuario y mostrar estadísticas',
      callback: async () => {
        state.greetingsCount += 1;
        state.lastGreeted = new Date().toISOString();
        await this.saveData(state);

        this.lastNotice = new Notice(
          `¡Hola desde IndexLy! Has ejecutado este comando ${state.greetingsCount} veces.`,
          5000
        );

        if (statusEl) {
          statusEl.textContent = `Hello: Activo (${state.greetingsCount})`;
        }
      },
    });

    // 3. Añadir botón en la barra lateral Ribbon con icono interactivo
    this.addRibbonIcon('smile', 'Saludar con IndexLy', async () => {
      state.greetingsCount += 1;
      state.lastGreeted = new Date().toISOString();
      await this.saveData(state);

      this.lastNotice = new Notice(`¡Saludos desde la barra lateral! Total: ${state.greetingsCount}`);

      if (statusEl) {
        statusEl.textContent = `Hello: Activo (${state.greetingsCount})`;
      }
    });

    // 4. Añadir elemento en la barra de estado inferior (Status Bar)
    const statusEl = this.addStatusBarItem();
    statusEl.textContent = `Hello: Activo (${state.greetingsCount})`;
    statusEl.style.padding = '0 8px';
    statusEl.style.fontSize = '12px';

    // 5. Registrar un intervalo periódico reversible
    // Se cancela automáticamente sin fugas al desactivar o recargar el plugin
    this.registerInterval(
      window.setInterval(() => {
        if (statusEl) {
          statusEl.title = `Último saludo: ${state.lastGreeted || 'Nunca'}`;
        }
      }, 10000)
    );
  }

  /**
   * Hook de descarga del plugin.
   * Todos los recursos registrados mediante `this.register*` y `this.add*`
   * se limpian de forma atómica en orden LIFO inmediatamente después.
   */
  async onunload() {
    if (this.lastNotice) {
      this.lastNotice.hide();
    }
    const container = document.querySelector('.indexly-notice-container');
    if (container && container.childNodes.length === 0) {
      container.remove();
    }
    console.log(`[HelloCommandPlugin] Descarga finalizada con éxito.`);
  }
};
