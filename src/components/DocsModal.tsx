// src/components/DocsModal.tsx — Wrapper para compatibilidad hacia atrás
import React from 'react';
import { DocsView } from './DocsView';

interface DocsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DocsModal: React.FC<DocsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;
  return <DocsView onClose={onClose} />;
};

export { DocsView };
