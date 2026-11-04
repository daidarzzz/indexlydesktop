// src/components/HubConnectModal.tsx — Modal para conectar token de IndexlyHub
import React, { useState } from 'react';
import { Globe, Key } from 'lucide-react';
import { Button, Callout, Field, Input, Modal } from '../ui';

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
    <Modal
      open={isOpen}
      onClose={onClose}
      size="sm"
      title="Conectar IndexlyHub"
      description="Explora catálogos comunitarios, guarda favoritos y sincroniza índices oficiales."
      footer={
        <>
          {token && (
            <Button
              variant="danger"
              onClick={() => {
                onDisconnect();
                setInputVal('');
                onClose();
              }}
            >
              Desconectar
            </Button>
          )}
          <Button variant="primary" onClick={handleSave} loading={loading}>
            {token ? 'Guardar cambios' : 'Conectar'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Globe size={16} color="var(--color-primary)" aria-hidden="true" />
          <span>
            Conecta tu cuenta de <strong>IndexlyHub</strong> para mantener tus índices al día.
          </span>
        </div>

        <Field
          label="Token de API (Bearer)"
          description={
            <>
              Puedes generar tu token en{' '}
              <a
                href="https://indexlyhub.daida.net/settings"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
              >
                indexlyhub.daida.net/settings
              </a>
            </>
          }
          error={error ?? undefined}
        >
          {({ id, ...control }) => (
            <Input
              {...control}
              id={id}
              type="password"
              placeholder="ih_…"
              value={inputVal}
              leadingIcon={<Key size={14} />}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSave();
                }
              }}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          )}
        </Field>

        {token && (
          <Callout variant="success" title="Conectado">
            Actualmente conectado al Hub.
          </Callout>
        )}
      </div>
    </Modal>
  );
};
