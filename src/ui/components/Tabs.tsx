/**
 * @file src/ui/components/Tabs.tsx
 * @description Pestañas subrayadas y control segmentado, ambos accesibles.
 */

import React, { useId } from 'react';
import { cn } from '../cn';

export interface TabItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  count?: number;
  /** Contenido adicional a la derecha (p. ej. un punto de estado). */
  trailing?: React.ReactNode;
  disabled?: boolean;
}

export type TabsVariant = 'underline' | 'segmented';

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: TabsVariant;
  /** Etiqueta accesible del tablist. */
  ariaLabel?: string;
  /** Id del panel controlado; se usa para `aria-controls`. */
  panelId?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  items,
  value,
  onChange,
  variant = 'underline',
  ariaLabel,
  panelId,
  className,
  ...rest
}) => {
  const baseId = useId();
  const tabId = (id: string) => `${baseId}-tab-${id}`;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'ix-tabs',
        variant === 'segmented' && 'ix-tabs--segmented',
        className,
      )}
      {...rest}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            id={tabId(item.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className="ix-tab"
            onClick={() => onChange(item.id)}
          >
            {item.icon}
            {item.label}
            {item.count != null && <span className="ix-tab__count">{item.count}</span>}
            {item.trailing}
          </button>
        );
      })}
    </div>
  );
};

export interface SegmentedControlProps extends Omit<TabsProps, 'variant'> {}

export const SegmentedControl: React.FC<SegmentedControlProps> = (props) => (
  <Tabs {...props} variant="segmented" />
);
