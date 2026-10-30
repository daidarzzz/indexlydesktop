// src/components/HubConnectModal.tsx — Modal para conectar token de IndexlyHub
import React, { useState } from 'react';
import { X, Globe, Key, CheckCircle, AlertCircle } from 'lucide-react';

interface HubConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  onSaveToken: (token: string) => Promise<boolean>;
  onDisconnect: () => void;
}

export const HubConnectModal: React.FC<HubConnectModalProps> = ({
  isOpen,
  onClose,
  token,
  onSaveToken,
  onDisconnect,
}) => {
  const [inputVal, setInputVal] = useState(token || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    const clean = inputVal.trim();
    if (!clean) {
      setError('Por favor introduce tu token ih_…');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ok = await onSaveToken(clean);
      if (ok) {
        onClose();
      } else {
        setError('Token inválido o no reconocido por el Hub.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error verificando el token con IndexlyHub');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={18} color="var(--color-primary)" />
            <h3>Conectar IndexlyHub</h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} title="Cerrar modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
            Conecta tu cuenta de <strong>IndexlyHub</strong> para explorar catálogos comunitarios, guardar favoritos y sincronizar actualizaciones de índices oficiales.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text)' }}>
              Token de API (Bearer)
            </label>
            <div style={{ position: 'relative' }}>
              <Key
                size={14}
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-text-tertiary)',
                }}
              />
              <input
                type="password"
                placeholder="ih_…"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 34px',
                  borderRadius: '10px',
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  fontSize: '13px',
                  fontFamily: 'var(--font-mono)',
                  outline: 'none',
                }}
              />
            </div>
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              Puedes generar tu token en{' '}
              <a
                href="https://indexlyhub.daida.net/settings"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
              >
                indexlyhub.daida.net/settings
              </a>
            </span>
          </div>

          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: '#f87171',
                fontSize: '12px',
                marginBottom: '16px',
              }}
            >
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          {token && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px',
                borderRadius: '8px',
                background: 'rgba(34, 197, 94, 0.08)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                color: '#4ade80',
                fontSize: '12px',
                marginBottom: '16px',
              }}
            >
              <CheckCircle size={14} />
              <span>Actualmente conectado al Hub</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            {token && (
              <button
                type="button"
                className="action-btn secondary"
                onClick={() => {
                  onDisconnect();
                  setInputVal('');
                  onClose();
                }}
                style={{ color: '#f87171' }}
              >
                Desconectar
              </button>
            )}
            <button
              type="button"
              className="action-btn"
              onClick={handleSave}
              disabled={loading}
              style={{
                background: 'var(--color-text)',
                color: 'var(--color-bg)',
                padding: '8px 16px',
                fontWeight: 600,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Verificando…' : token ? 'Guardar Cambios' : 'Conectar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
