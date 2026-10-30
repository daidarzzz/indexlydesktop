/**
 * @file src/plugins/api/ui.ts
 * @description Clases base y componentes estándar de UI para extensiones de IndexLy (`Modal`, `Notice`, `Setting`, `PluginSettingTab`).
 */

import { App } from '../types';

/**
 * Notificación temporal flotante en pantalla (Toast).
 */
export class Notice {
  public noticeEl: HTMLElement;
  private _timer: number | null = null;

  constructor(message: string, durationMs: number = 4500) {
    this.noticeEl = document.createElement('div');
    this.noticeEl.className = 'indexly-notice';
    this.noticeEl.setAttribute('role', 'alert');
    this.noticeEl.textContent = message;

    let container = document.querySelector('.indexly-notice-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'indexly-notice-container';
      document.body.appendChild(container);
    }
    container.appendChild(this.noticeEl);

    if (durationMs > 0) {
      this._timer = window.setTimeout(() => {
        this.hide();
      }, durationMs);
    }
  }

  /**
   * Oculta y retira la notificación del DOM.
   */
  public hide(): void {
    if (this._timer !== null) {
      window.clearTimeout(this._timer);
      this._timer = null;
    }
    this.noticeEl.classList.add('fading-out');
    setTimeout(() => {
      this.noticeEl.remove();
    }, 200);
  }
}

/**
 * Ventana modal accesible y centrada con backdrop oscuro.
 */
export abstract class Modal {
  public readonly app: App;
  public containerEl: HTMLElement;
  public modalEl: HTMLElement;
  public titleEl: HTMLElement;
  public contentEl: HTMLElement;
  private _keydownListener: ((e: KeyboardEvent) => void) | null = null;

  constructor(app: App) {
    this.app = app;

    // Contenedor overlay (backdrop)
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'indexly-modal-backdrop';
    this.containerEl.style.display = 'none';

    // Caja modal
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'indexly-modal';
    this.modalEl.setAttribute('role', 'dialog');
    this.modalEl.setAttribute('aria-modal', 'true');

    // Botón de cierre
    const closeBtn = document.createElement('button');
    closeBtn.className = 'indexly-modal-close-btn';
    closeBtn.setAttribute('aria-label', 'Cerrar');
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => this.close();
    this.modalEl.appendChild(closeBtn);

    // Cabecera / Título
    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'indexly-modal-title';
    this.modalEl.appendChild(this.titleEl);

    // Contenedor de contenido
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'indexly-modal-content';
    this.modalEl.appendChild(this.contentEl);

    this.containerEl.appendChild(this.modalEl);

    // Cerrar al hacer clic en el backdrop fuera del modal
    this.containerEl.onclick = (e) => {
      if (e.target === this.containerEl) {
        this.close();
      }
    };
  }

  /**
   * Abre y muestra el diálogo modal en pantalla.
   */
  public open(): void {
    if (!document.body.contains(this.containerEl)) {
      document.body.appendChild(this.containerEl);
    }
    this.containerEl.style.display = 'flex';
    this.containerEl.classList.add('open');

    this._keydownListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
    window.addEventListener('keydown', this._keydownListener);

    this.onOpen();
  }

  /**
   * Cierra el diálogo modal y limpia listeners de teclado.
   */
  public close(): void {
    this.containerEl.classList.remove('open');
    this.containerEl.style.display = 'none';

    if (this._keydownListener) {
      window.removeEventListener('keydown', this._keydownListener);
      this._keydownListener = null;
    }

    this.onClose();
    this.containerEl.remove();
  }

  abstract onOpen(): void;
  abstract onClose(): void;
}

/**
 * Pestaña de ajustes dedicada para un plugin.
 */
export abstract class PluginSettingTab {
  public readonly app: App;
  public readonly plugin: any;
  public containerEl: HTMLElement;

  constructor(app: App, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'indexly-setting-tab-content';
  }

  /**
   * Hook invocado cuando la pestaña es visualizada por el usuario.
   */
  abstract display(): void;

  /**
   * Hook invocado cuando la pestaña es ocultada.
   */
  public hide(): void {
    this.containerEl.replaceChildren();
  }
}

/**
 * Fila de ajuste estándar configurable (nombre, descripción, control interactivo).
 */
export class Setting {
  public settingEl: HTMLElement;
  public infoEl: HTMLElement;
  public nameEl: HTMLElement;
  public descEl: HTMLElement;
  public controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
    this.settingEl.className = 'indexly-setting-item';

    this.infoEl = document.createElement('div');
    this.infoEl.className = 'indexly-setting-info';

    this.nameEl = document.createElement('div');
    this.nameEl.className = 'indexly-setting-name';
    this.infoEl.appendChild(this.nameEl);

    this.descEl = document.createElement('div');
    this.descEl.className = 'indexly-setting-desc';
    this.infoEl.appendChild(this.descEl);

    this.controlEl = document.createElement('div');
    this.controlEl.className = 'indexly-setting-control';

    this.settingEl.appendChild(this.infoEl);
    this.settingEl.appendChild(this.controlEl);
    containerEl.appendChild(this.settingEl);
  }

  public setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }

  public setDesc(desc: string): this {
    this.descEl.textContent = desc;
    return this;
  }

  public addToggle(cb: (toggle: { setValue: (v: boolean) => void; getValue: () => boolean; onChange: (fn: (v: boolean) => void) => void }) => unknown): this {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'indexly-toggle';

    let changeHandler: ((v: boolean) => void) | null = null;
    input.onchange = () => {
      if (changeHandler) changeHandler(input.checked);
    };

    const component = {
      setValue: (v: boolean) => {
        input.checked = v;
      },
      getValue: () => input.checked,
      onChange: (fn: (v: boolean) => void) => {
        changeHandler = fn;
      },
    };

    this.controlEl.appendChild(input);
    cb(component);
    return this;
  }

  public addText(cb: (text: { setValue: (v: string) => void; getValue: () => string; onChange: (fn: (v: string) => void) => void; setPlaceholder: (p: string) => void }) => unknown): this {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'indexly-text-input';

    let changeHandler: ((v: string) => void) | null = null;
    input.oninput = () => {
      if (changeHandler) changeHandler(input.value);
    };

    const component = {
      setValue: (v: string) => {
        input.value = v;
      },
      getValue: () => input.value,
      onChange: (fn: (v: string) => void) => {
        changeHandler = fn;
      },
      setPlaceholder: (p: string) => {
        input.placeholder = p;
      },
    };

    this.controlEl.appendChild(input);
    cb(component);
    return this;
  }

  public addButton(cb: (btn: { setButtonText: (t: string) => void; setCta: () => void; onClick: (fn: () => void) => void }) => unknown): this {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-btn secondary';

    let clickHandler: (() => void) | null = null;
    button.onclick = () => {
      if (clickHandler) clickHandler();
    };

    const component = {
      setButtonText: (t: string) => {
        button.textContent = t;
      },
      setCta: () => {
        button.className = 'action-btn primary';
      },
      onClick: (fn: () => void) => {
        clickHandler = fn;
      },
    };

    this.controlEl.appendChild(button);
    cb(component);
    return this;
  }
}
