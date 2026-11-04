// src/components/__tests__/DocsModal.test.tsx — Pruebas unitarias de la vista de documentación (DocsView / DocsModal)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DocsView } from '../DocsView';
import { DocsModal } from '../DocsModal';

describe('DocsView (Pestaña de Documentación)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renderiza la cabecera, sidebar y sección inicial de la pestaña', () => {
    render(<DocsView onClose={vi.fn()} />);
    const nav = within(screen.getByRole('navigation', { name: 'Índice de documentación' }));

    expect(screen.getByText('Documentación Técnica')).toBeDefined();
    expect(screen.getAllByText(/IndexLy Platform v2.0/i).length).toBeGreaterThan(0);
    expect(nav.getByText('Arquitectura & Visión')).toBeDefined();
    expect(nav.getByText('Modelo de Confianza')).toBeDefined();
    expect(nav.getByText('Ciclo de Vida & Plugin Base')).toBeDefined();
    expect(nav.getByText('Grafo de APIs (app.*)')).toBeDefined();
    expect(nav.getByText('Acceso Nativo (app.native)')).toBeDefined();
    expect(nav.getByText('Componentes de UI')).toBeDefined();
    expect(nav.getByText('Testing Kit Oficial')).toBeDefined();
    expect(nav.getByText('Plugins de Referencia')).toBeDefined();
    expect(nav.getByText('Modo Dev, Safe Mode & Atajos')).toBeDefined();
  });

  it('permite cambiar de sección al hacer click en un elemento del sidebar', () => {
    render(<DocsView onClose={vi.fn()} />);

    // Por defecto está en 'overview'
    expect(screen.getByText('Arquitectura del Sistema')).toBeDefined();

    // Hacemos click en "Modelo de Confianza" (en el índice lateral)
    const nav = within(screen.getByRole('navigation', { name: 'Índice de documentación' }));
    const trustBtn = nav.getByText('Modelo de Confianza');
    fireEvent.click(trustBtn);

    expect(screen.getByText('Obsidian Trust Model')).toBeDefined();
    expect(screen.getByText('Modo Restringido Global')).toBeDefined();
  });

  it('filtra las secciones dinámicamente según la búsqueda', () => {
    render(<DocsView onClose={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText('Filtrar temas, APIs o código...');
    fireEvent.change(searchInput, { target: { value: 'sqlite' } });
    const nav = within(screen.getByRole('navigation', { name: 'Índice de documentación' }));

    // Secciones que contienen sqlite o etiquetas afines deben permanecer
    expect(nav.getByText('Arquitectura & Visión')).toBeDefined();
    expect(nav.getByText('Acceso Nativo (app.native)')).toBeDefined();

    // Filtro sin coincidencias
    fireEvent.change(searchInput, { target: { value: 'termino-inexistente-xyz' } });
    expect(screen.getByText(/No se encontraron secciones/i)).toBeDefined();
  });

  // "Volver al buscador" vive ahora en la barra superior de la app; la vista
  // ofrece en su lugar navegación anterior / siguiente entre secciones.
  it('navega a la siguiente sección con el botón "Siguiente"', () => {
    render(<DocsView onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Siguiente'));

    expect(screen.getByText('Obsidian Trust Model')).toBeDefined();
  });

  it('copia código al portapapeles al pulsar el botón Copiar', () => {
    render(<DocsView onClose={vi.fn()} />);

    // Cambiar a Ciclo de Vida que tiene botón de copiar
    const lifecycleBtn = screen.getByText('Ciclo de Vida & Plugin Base');
    fireEvent.click(lifecycleBtn);

    const copyBtn = screen.getByText('Copiar');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it('DocsModal wrapper no renderiza nada cuando isOpen es false y renderiza cuando es true', () => {
    const { container } = render(<DocsModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();

    const { unmount } = render(<DocsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Documentación Técnica')).toBeDefined();
    unmount();
  });
});
