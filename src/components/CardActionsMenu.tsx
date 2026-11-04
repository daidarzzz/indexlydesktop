// src/components/CardActionsMenu.tsx — Menú "⋯" con las acciones que los plugins
// añaden a cada resultado. Sustituye a la fila de botones sueltos: por muchas
// acciones que haya, la tarjeta siempre ocupa lo mismo.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { UnifiedItem } from '../types';

interface CardActionsMenuProps {
  item: UnifiedItem;
}

const MENU_WIDTH = 220;
const GAP = 6;

export const CardActionsMenu: React.FC<CardActionsMenuProps> = ({ item }) => {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'below' | 'above' }>({
    top: 0,
    left: 0,
    placement: 'below',
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Reaccionar a plugins que registran/retiran acciones en caliente
  useEffect(() => pluginRegistry.subscribe(() => setTick((t) => t + 1)), []);

  const actions = pluginRegistry.getCardActions().filter((a) => !a.condition || a.condition(item));

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Colocar el menú junto al botón; si no cabe debajo, se abre hacia arriba
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 0;
    const spaceBelow = window.innerHeight - r.bottom;
    const placement = menuH && spaceBelow < menuH + GAP + 8 && r.top > spaceBelow ? 'above' : 'below';
    const top = placement === 'below' ? r.bottom + GAP : r.top - GAP - menuH;
    const left = Math.min(Math.max(8, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    setPos({ top, left, placement });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Segunda pasada con la altura real del menú ya montado
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  // Cerrar al hacer clic fuera, al hacer scroll o al redimensionar
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      close();
    };
    const onResize = () => close();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  if (actions.length === 0) return null;

  const run = (index: number) => {
    const action = actions[index];
    close(true);
    if (!action) return;
    try {
      action.onClick(item);
    } catch (err) {
      console.error(`[CardActionsMenu] Error en acción de '${action.pluginId}':`, err);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % actions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + actions.length) % actions.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(actions.length - 1);
    }
  };

  const toggle = (e: React.MouseEvent | React.KeyboardEvent, startIndex = 0) => {
    e.stopPropagation();
    setActiveIndex(startIndex);
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`card-menu-trigger ${open ? 'is-open' : ''}`}
        aria-label={`Más acciones para ${item.title}`}
        title="Más acciones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => toggle(e)}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.stopPropagation();
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) toggle(e, e.key === 'ArrowUp' ? actions.length - 1 : 0);
          }
        }}
      >
        <MoreHorizontal size={15} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={`card-menu card-menu--${pos.placement}`}
            role="menu"
            aria-label="Acciones de plugins"
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
            onKeyDown={onMenuKeyDown}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <div className="card-menu__label">Acciones</div>
            {actions.map((action, idx) => (
              <button
                key={`${action.pluginId}-${idx}`}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={idx === activeIndex ? 0 : -1}
                className={`card-menu__item ${idx === activeIndex ? 'is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => run(idx)}
                title={action.label}
              >
                <span className="card-menu__text">{action.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
};
