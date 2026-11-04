// src/components/__tests__/CommandPaletteModal.test.tsx — Pruebas unitarias de la Paleta de Comandos (Ctrl+P)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPaletteModal } from '../CommandPaletteModal';
import { pluginHost } from '../../plugins/host/PluginHost';

describe('CommandPaletteModal (Paleta de Comandos Ctrl+P)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Limpiar comandos previos
    const existing = pluginHost.sharedCommands.listCommands();
    existing.forEach((c) => pluginHost.sharedCommands.removeCommand(c.id));
  });

  it('no se renderiza en el DOM si isOpen es false', () => {
    const { container } = render(<CommandPaletteModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('se renderiza correctamente al abrirse y muestra comandos del sistema', () => {
    render(
      <CommandPaletteModal
        isOpen={true}
        onClose={vi.fn()}
        onOpenDocs={vi.fn()}
        onOpenPlugins={vi.fn()}
        onOpenHub={vi.fn()}
        onFocusSearch={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText(/Escribe un comando o busca/i)).toBeDefined();
    expect(screen.getByText('Documentación: Abrir Guía Completa de IndexLy')).toBeDefined();
    expect(screen.getByText('Plugins: Abrir Gestor de Extensiones')).toBeDefined();
    expect(screen.getByText('Hub: Explorar IndexlyHub')).toBeDefined();
  });

  it('muestra comandos dinámicos registrados por plugins en pluginHost.sharedCommands', () => {
    pluginHost.sharedCommands.addCommand({
      id: 'test-custom-command',
      name: 'Abrir Bloc de Notas Especial',
      defaultShortcut: 'Ctrl+P',
      callback: vi.fn(),
    });

    render(<CommandPaletteModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Abrir Bloc de Notas Especial')).toBeDefined();
    expect(screen.getByText('Plugin')).toBeDefined();
  });

  it('filtra los comandos en tiempo real según el texto ingresado', () => {
    pluginHost.sharedCommands.addCommand({
      id: 'open-scratchpad',
      name: 'Abrir Bloc de Notas',
      callback: vi.fn(),
    });
    pluginHost.sharedCommands.addCommand({
      id: 'quick-stats',
      name: 'Mostrar Estadísticas Rápidas',
      callback: vi.fn(),
    });

    render(<CommandPaletteModal isOpen={true} onClose={vi.fn()} onOpenDocs={vi.fn()} />);

    const input = screen.getByPlaceholderText(/Escribe un comando o busca/i);
    fireEvent.change(input, { target: { value: 'scratchpad' } });

    expect(screen.getByText('Abrir Bloc de Notas')).toBeDefined();
    expect(screen.queryByText('Mostrar Estadísticas Rápidas')).toBeNull();
    expect(screen.queryByText('Documentación: Abrir Guía Completa de IndexLy')).toBeNull();
  });

  it('ejecuta el comando y cierra la paleta al hacer click o pulsar Enter', async () => {
    const mockCallback = vi.fn();
    const mockClose = vi.fn();

    pluginHost.sharedCommands.addCommand({
      id: 'cmd-to-run',
      name: 'Comando Ejecutable',
      callback: mockCallback,
    });

    render(<CommandPaletteModal isOpen={true} onClose={mockClose} />);

    const cmdEl = screen.getByText('Comando Ejecutable');
    fireEvent.click(cmdEl);

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockCallback).toHaveBeenCalledTimes(1);
  });

  it('cierra la paleta al pulsar la tecla Escape', () => {
    const mockClose = vi.fn();
    render(<CommandPaletteModal isOpen={true} onClose={mockClose} />);

    const input = screen.getByPlaceholderText(/Escribe un comando o busca/i);
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
