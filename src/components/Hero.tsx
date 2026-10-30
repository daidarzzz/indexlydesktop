// src/components/Hero.tsx — Hero banner de IndexLy
import React from 'react';

export const Hero: React.FC = () => {
  return (
    <div className="hero">
      <div className="hero-badge">
        <span className="hero-dot" />
        Gestor de índices local & privado · Rust FTS5
      </div>
      <h1>Encuentra <em>todo</em> en segundos.</h1>
      <p>
        Carga tus archivos de lo que quieras —juegos, libros, pelis o lo que uses—, combina múltiples fuentes y busca entre millones de elementos a velocidad nativa.
      </p>
    </div>
  );
};
