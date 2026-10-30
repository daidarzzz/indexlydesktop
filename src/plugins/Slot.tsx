// src/plugins/Slot.tsx — Punto de inyección de UI para plugins
import React, { useEffect, useState } from 'react';
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
          <div
            key={sec.id}
            className="plx-section"
            ref={(el) => {
              if (el && !el.dataset.rendered) {
                el.dataset.rendered = 'true';
                try {
                  sec.render(el);
                } catch (err) {
                  console.error(`[Slot] Error render sección ${sec.id}:`, err);
                }
              }
            }}
          />
        ))}
      </div>
    );
  }

  const customRenderers = pluginRegistry.getSlotRenderers(name);
  if (customRenderers.length > 0) {
    return (
      <div className={`slot-${name}`} style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
        {customRenderers.map((r, idx) => (
          <div
            key={`${r.pluginId}-${idx}`}
            className={`plx-slot-item plx-slot-${name}`}
            ref={(el) => {
              if (el && !el.dataset.rendered) {
                el.dataset.rendered = 'true';
                try {
                  r.render(el, context);
                } catch (err) {
                  console.error(`[Slot] Error render slot ${name}:`, err);
                }
              }
            }}
          />
        ))}
      </div>
    );
  }

  return null;
};

interface OverrideProps {
  name: string;
  props?: any;
  fallback: React.ReactNode;
}

export const Override: React.FC<OverrideProps> = ({ name, props, fallback }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    return pluginRegistry.subscribe(() => setTick((t) => t + 1));
  }, []);

  const override = pluginRegistry.getComponentOverride(name);
  if (override) {
    return (
      <div
        className={`plx-override plx-override-${name}`}
        ref={(el) => {
          if (el) {
            el.innerHTML = '';
            try {
              override.render(el, props);
            } catch (err) {
              console.error(`[Override] Error render override ${name}:`, err);
            }
          }
        }}
      />
    );
  }

  return <>{fallback}</>;
};
