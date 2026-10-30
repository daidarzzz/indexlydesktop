// src/components/__tests__/DocsModal.test.tsx — Pruebas unitarias del modal de documentación
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DocsModal } from '../DocsModal';

describe('DocsModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('no renderiza nada cuando isOpen es false', () => {
    const { container } = render(<DocsModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renderiza la cabecera, sidebar y sección inicial cuando isOpen es true', () => {
    render(<DocsModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Documentación de IndexLy')).toBeDefined();
    expect(screen.getByText('v2.0 Native')).toBeDefined();
    expect(screen.getByText('Arquitectura & Visión')).toBeDefined();
    expect(screen.getByText('Modelo de Confianza')).toBeDefined();
    expect(screen.getByText('Ciclo de Vida & Plugin Base')).toBeDefined();
    expect(screen.getByText('Grafo de APIs (app.*)')).toBeDefined();
    expect(screen.getByText('Acceso Nativo (app.native)')).toBeDefined();
    expect(screen.getByText('Componentes de UI')).toBeDefined();
    expect(screen.getByText('Testing Kit Oficial')).toBeDefined();
    expect(screen.getByText('Plugins de Referencia')).toBeDefined();
    expect(screen.getByText('Modo Dev, Safe Mode & Atajos')).toBeDefined();
  });

  it('permite cambiar de sección al hacer click en un elemento del sidebar', () => {
    render(<DocsModal isOpen={true} onClose={vi.fn()} />);

    // Por defecto está en 'overview'
    expect(screen.getByText('Arquitectura del Sistema')).toBeDefined();

    // Hacemos click en "Modelo de Confianza"
    const trustBtn = screen.getByText('Modelo de Confianza');
    fireEvent.click(trustBtn);

    expect(screen.getByText('Obsidian Trust Model')).toBeDefined();
    expect(screen.getByText('Modo Restringido Global')).toBeDefined();
  });

  it('filtra las secciones dinámicamente según la búsqueda', () => {
    render(<DocsModal isOpen={true} onClose={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText('Filtrar temas, APIs o código...');
    fireEvent.change(searchInput, { target: { value: 'sqlite' } });

    // Secciones que contienen sqlite o etiquetas afines deben permanecer
    expect(screen.getByText('Arquitectura & Visión')).toBeDefined();
    expect(screen.getByText('Acceso Nativo (app.native)')).toBeDefined();

    // Filtro sin coincidencias
    fireEvent.change(searchInput, { target: { value: 'termino-inexistente-xyz' } });
    expect(screen.getByText(/No se encontraron secciones/i)).toBeDefined();
  });

  it('invoca onClose al presionar el botón de cerrar', () => {
    const handleClose = vi.fn();
    render(<DocsModal isOpen={true} onClose={handleClose} />);

    const closeBtn = screen.getByTitle('Cerrar documentación (Esc)');
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('copia código al portapapeles al pulsar el botón Copiar', () => {
    render(<DocsModal isOpen={true} onClose={vi.fn()} />);

    // Cambiar a Ciclo de Vida que tiene botón de copiar
    const lifecycleBtn = screen.getByText('Ciclo de Vida & Plugin Base');
    fireEvent.click(lifecycleBtn);

    const copyBtn = screen.getByText('Copiar');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});
