// src/plugins/Slot.tsx — Punto de inyección de UI para plugins con gestión de ciclo de vida limpia
import React, { useEffect, useState, useRef } from 'react';
import { pluginRegistry } from './PluginRegistry';
import { UnifiedItem } from '../types';

interface SlotProps {
  name: 'card_actions' | 'search_chips' | 'sections' | 'mapping_modal' | string;
  context?: any;
}

export const Slot: React.FC<SlotProps> = ({ name, context }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    return pluginRegistry.subscribe(() => setTick((t) => t + 1));
  }, []);

  if (name === 'card_actions') {
    const item = context as UnifiedItem;
    const actions = pluginRegistry.getCardActions();
    const visibleActions = actions.filter((a) => !a.condition || a.condition(item));

    if (visibleActions.length === 0) return null;

    return (
      <div className="slot-card-actions" style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
        {visibleActions.map((action, idx) => (
          <button
            key={`${action.pluginId}-${idx}`}
            type="button"
            className="action-btn secondary plx-card-action"
            onClick={(e) => {
              e.stopPropagation();
              action.onClick(item);
            }}
            title={action.label}
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  }

  if (name === 'search_chips') {
    const chips = pluginRegistry.getChips();
    if (chips.length === 0) return null;

    return (
      <>
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`chip plx-chip ${chip.active ? 'active' : ''}`}
            onClick={chip.onClick}
          >
            {chip.label}
          </button>
        ))}
      </>
    );
  }

  if (name === 'sections') {
    const sections = pluginRegistry.getSections();
    if (sections.length === 0) return null;

    return (
      <div className="slot-sections" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {sections.map((sec) => (
          <SectionItem key={sec.id} section={sec} />
        ))}
      </div>
    );
  }

  const customRenderers = pluginRegistry.getSlotRenderers(name);
  if (customRenderers.length > 0) {
    return (
      <div className={`slot-${name}`} style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
        {customRenderers.map((r, idx) => (
          <SlotRendererItem key={`${r.pluginId}-${idx}`} renderer={r} slotName={name} context={context} />
        ))}
      </div>
    );
  }

  return null;
};

/**
 * Componente hijo para renderizado reactivo y limpieza de secciones (Solución a Bug 9)
 */
const SectionItem: React.FC<{ section: { id: string; render: (container: HTMLElement) => void } }> = ({ section }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.replaceChildren();
    try {
      section.render(el);
    } catch (err) {
      console.error(`[Slot] Error en render de sección '${section.id}':`, err);
    }

    return () => {
      el.replaceChildren();
    };
  }, [section]);

  return <div className="plx-section" ref={containerRef} />;
};

/**
 * Componente hijo para slot custom con ciclo de vida limpio (Solución a Bug 9)
 */
const SlotRendererItem: React.FC<{
  renderer: { pluginId: string; render: (container: HTMLElement, context: any) => void };
  slotName: string;
  context: any;
}> = ({ renderer, slotName, context }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.replaceChildren();
    try {
      renderer.render(el, context);
    } catch (err) {
      console.error(`[Slot] Error en renderer de slot '${slotName}':`, err);
    }

    return () => {
      el.replaceChildren();
    };
  }, [renderer, slotName, context]);

  return <div className={`plx-slot-item plx-slot-${slotName}`} ref={containerRef} />;
};

interface OverrideProps {
  name: string;
  props?: any;
  fallback: React.ReactNode;
}

/**
 * Componente Override con preservación del DOM en re-renders (Solución a Bug 10)
 */
export const Override: React.FC<OverrideProps> = ({ name, props, fallback }) => {
  const [, setTick] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mountedTargetRef = useRef<string | null>(null);

  useEffect(() => {
    return pluginRegistry.subscribe(() => setTick((t) => t + 1));
  }, []);

  const override = pluginRegistry.getComponentOverride(name);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !override) return;

    // Solo limpiar y re-renderizar si cambia el objetivo de override o plugin montado
    if (mountedTargetRef.current !== `${override.pluginId}:${override.target}`) {
      mountedTargetRef.current = `${override.pluginId}:${override.target}`;
      el.replaceChildren();
      try {
        override.render(el, props);
      } catch (err) {
        console.error(`[Override] Error render override '${name}':`, err);
      }
    }

    return () => {
      if (mountedTargetRef.current) {
        mountedTargetRef.current = null;
        if (el) el.replaceChildren();
      }
    };
  }, [override, name, props]);

  if (override) {
    return <div className={`plx-override plx-override-${name}`} ref={containerRef} />;
  }

  return <>{fallback}</>;
};
