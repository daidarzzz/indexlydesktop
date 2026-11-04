# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop (Tauri v2: Windows, macOS, Linux) + static landing page (Persuade mode)

## Users

Power users, archivistas, coleccionistas digitales y desarrolladores que gestionan bibliotecas heterogéneas dispersas en múltiples discos y directorios (juegos de Steam/GOG/ROMs, películas 4K, libros en Calibre, colecciones de música FLAC, índices de torrents, volcados CSV) y necesitan un punto de acceso unificado ultrarrápido sin ceder sus datos personales a servicios en la nube.

## Product Purpose

IndexLy Desktop reúne y normaliza catálogos locales desconectados en un índice universal de texto completo (SQLite FTS5) acelerado por Rust. Su propósito es erradicar el tiempo perdido buscando archivos locales y ofrecer una experiencia de búsqueda instantánea (<0.5 ms) accesible globalmente mediante un atajo nativo del sistema operativo (Ctrl/Cmd + K).

## Positioning

A diferencia de los gestores SaaS en la nube (Notion, Airtable, Letterboxd) que imponen latencias de red de 400 ms, cuotas de suscripción mensual y encierran tus metadatos en servidores ajenos, IndexLy opera de forma 100% soberana y sin conexión a internet. Los datos residen en bases de datos SQLite abiertas en tu máquina, con arquitectura de plugins sin sandbox ficticio inspirada en Obsidian y cero telemetría.

## Core Capabilities

- Motor de indexación nativo en Rust + SQLite FTS5 con normalización de diacríticos (`deunicode`).
- Atajo global de sistema operativo instantáneo (`tauri-plugin-global-shortcut`).
- Arquitectura de plugins extensible basada en el modelo Obsidian (`@indexly/plugin-api`).
- Mapeo dinámico de fuentes de datos (CSV, JSON, APIs locales, carpetas de archivos).
- Bloqueador de rastreadores nativo integrado en Rust para enriquecimiento seguro de carátulas.
- Almacenamiento local-first abierto y portable (`.sqlite`).
