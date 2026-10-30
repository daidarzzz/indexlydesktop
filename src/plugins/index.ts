/**
 * @file src/plugins/index.ts
 * @description Punto de exportación central para la arquitectura de plugins de IndexLy Desktop (v1).
 */

// Tipos
export * from './types';

// Errores
export * from './api/errors';

// Clases base y componentes
export * from './api/Component';
export * from './api/Plugin';
export * from './api/ui';

// APIs modulares del host
export * from './api/EventsApi';
export * from './api/CommandsApi';
export * from './api/StorageApi';
export * from './api/App';

// Núcleo del host
export * from './host/generation';
export * from './host/SafeCall';
export * from './host/SafeMode';
export * from './host/PluginLoader';
export * from './host/PluginHost';

// Adaptador legacy
export * from './legacy/LegacyAdapter';

// Test harness & Mock test kit
export * from './test-kit';
