# Postura de Seguridad y Transparencia

Este documento define la postura oficial de seguridad para el ecosistema de plugins de IndexLy Desktop.

---

## 1. Realismo Técnico vs Ilusión de Seguridad

En aplicaciones de escritorio modernas que permiten a los usuarios ampliar sus capacidades con código de terceros (como Obsidian, Raycast, VS Code o NeoVim), aislar extensiones en cajas de arena impenetrables (sandboxes de navegador o procesos completamente aislados) resulta incompatible con la necesidad de acceder al sistema de archivos local, ejecutar binarios nativos, indexar bases de datos masivas y ofrecer una experiencia de usuario fluida sin latencia IPC interproceso.

**Nuestra postura es transparente:**
- **Ejecución in-process:** Los plugins se ejecutan en el mismo contexto de aplicación que el host.
- **Sin permisos de bloqueo ficticios:** No fingimos contar con un cortafuegos interno que impida a un plugin malicioso acceder a la memoria si se ejecuta en el mismo proceso. Los sistemas que simulan permisos restrictivos sin aislamiento a nivel de proceso o hardware generan una peligrosa falsa sensación de seguridad.

---

## 2. Los Cuatro Pilares de Seguridad de IndexLy

```mermaid
graph TD
    P1["1. Transparencia y Consentimiento (Permisos Declarativos)"]
    P2["2. Control Absoluto del Usuario (Modo Restringido & Opt-In)"]
    P3["3. Resiliencia y Detección de Fallos (Safe Execution & Timeouts)"]
    P4["4. Verificación Comunitaria y Hub (Auditoría Estática de Código)"]
```

### 2.1 Transparencia y Consentimiento Informado
- El campo `permissions` en `manifest.json` no es un mecanismo de bloqueo; es una declaración jurada del desarrollador para informar al usuario antes de la instalación.
- La interfaz de instalación muestra en lenguaje claro el significado de cada permiso (`fs:read` = "Leer archivos locales", `process:spawn` = "Ejecutar programas").
- Si una actualización introduce nuevos permisos, se solicita confirmación explícita al usuario antes de aplicarla.

### 2.2 Control Absoluto del Usuario
- **Activación Explícita:** Ningún plugin se activa automáticamente al instalarse o actualizarse.
- **Modo Restringido (Restricted Mode):** Interruptor global que apaga de inmediato la ejecución de cualquier código de terceros. Permite arrancar la app en un estado 100% oficial para descartar problemas o depurar.
- **Recuperación Automática de Arranque (Safe Mode):** Si IndexLy detecta que la aplicación no pudo iniciar limpiamente en 2 intentos consecutivos, arranca de forma forzosa en Modo Restringido.

### 2.3 Resiliencia y Aislamiento de Fallos
- Cada callback de plugin está envuelto en `safeCall()`. Un error o excepción no capturada en un plugin nunca destruye el hilo de la interfaz ni cuelga el host.
- Límites de tiempo estrictos (`onload` 10s, `onunload` 5s) impiden que un plugin mantenga congelado el arranque o cierre del programa.
- Detección de bloqueos de hilo (>250 ms) y desactivación preventiva si un plugin acumula fallos críticos repetidos.

### 2.4 Auditoría y Hub Abierto
- El código distribuido en el Hub oficial debe ser de código abierto y verificable.
- Los paquetes se someten a análisis estático automatizado en búsqueda de patrones sospechosos (ofuscación excesiva, llamadas `eval` innecesarias, URLs de exfiltración de credenciales).
- Firma de paquetes para certificar la autenticidad del autor.
