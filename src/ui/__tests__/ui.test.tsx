import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Switch,
  Tabs,
  mount,
  unmount,
} from '../index';

afterEach(() => {
  cleanup();
  document.body.className = '';
});

describe('Biblioteca de UI de IndexLy', () => {
  it('Button muestra spinner, se deshabilita y no dispara onClick al cargar', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Guardar
      </Button>,
    );

    const button = screen.getByRole('button', { name: /guardar/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Field conecta etiqueta, descripción y error con el control', () => {
    render(
      <Field label="Nombre" description="Visible en la biblioteca" error="Campo obligatorio">
        {(control) => <Input {...control} />}
      </Field>,
    );

    const input = screen.getByLabelText('Nombre');
    expect(input.id).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('description');
    expect(input.getAttribute('aria-describedby')).toContain('error');
    expect(screen.getByRole('alert').textContent).toBe('Campo obligatorio');
  });

  it('Switch refleja el estado y emite el valor contrario', () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch checked={false} onCheckedChange={onCheckedChange} label="Activar fuente" />,
    );

    const toggle = screen.getByRole('switch', { name: 'Activar fuente' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('Tabs marca la pestaña activa y notifica el cambio', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        ariaLabel="Secciones"
        value="fuentes"
        onChange={onChange}
        items={[
          { id: 'fuentes', label: 'Fuentes', count: 3 },
          { id: 'hub', label: 'Hub' },
        ]}
      />,
    );

    const fuentes = screen.getByRole('tab', { name: /fuentes/i });
    expect(fuentes.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Hub' }));
    expect(onChange).toHaveBeenCalledWith('hub');
  });

  it('Modal se monta en un portal, cierra con Escape y bloquea el scroll', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Ajustes">
        <p>Contenido</p>
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'Ajustes' })).toBeDefined();
    expect(document.body.classList.contains('ix-modal-open')).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Modal open={false} onClose={onClose} title="Ajustes">
        <p>Contenido</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.classList.contains('ix-modal-open')).toBe(false);
  });

  it('Badge y EmptyState renderizan su contenido accesible', () => {
    render(
      <>
        <Badge variant="success" dot>
          Conectado
        </Badge>
        <EmptyState
          title="Sin resultados"
          description="Prueba otra búsqueda"
          hints={['Revisa la ortografía']}
        />
      </>,
    );

    expect(screen.getByText('Conectado')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Sin resultados' })).toBeDefined();
    expect(screen.getByText('Revisa la ortografía')).toBeDefined();
  });

  it('mount y unmount gestionan un árbol React en un contenedor', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    act(() => {
      mount(<span>Vista de plugin</span>, container);
    });
    expect(container.textContent).toBe('Vista de plugin');

    act(() => {
      unmount(container);
    });
    expect(container.textContent).toBe('');

    container.remove();
  });
});
