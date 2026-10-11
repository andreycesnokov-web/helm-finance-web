import React, { useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatAmount } from '../lib/money';
import { Btn } from '../shell/ui';
import InfoTooltip from './InfoTooltip';

/**
 * BusinessWalletTransferModal:
 * Allows transferring funds between two business wallets belonging to the same company.
 * Calls atomic backend POST /api/wallets/transfer with:
 * - from_wallet_id, to_wallet_id
 * - amount, description
 * - transfer_id (client idempotency key)
 * - double-submit protection
 * - explicit validation (different wallets, amount > 0, currency support)
 */
export default function BusinessWalletTransferModal({
  token,
  wallets = [],
  userRole,
  onClose,
  onSuccess
}) {
  const activeWallets = (wallets || []).filter(w => w.is_active !== false);

  const [fromId, setFromId] = useState(activeWallets[0]?.id || '');
  const [toId, setToId] = useState(activeWallets[1]?.id || (activeWallets[0]?.id ? '' : ''));
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [transferId] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'xfer-' + Date.now() + '-' + Math.random().toString(36).slice(2)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const canTransfer = !userRole || ['owner', 'ceo', 'admin', 'cfo', 'accountant'].includes(userRole.toLowerCase());

  const fromWallet = activeWallets.find(w => w.id === fromId);
  const toWallet = activeWallets.find(w => w.id === toId);

  const fromCur = (fromWallet?.currency || 'IDR').toUpperCase();
  const toCur = (toWallet?.currency || 'IDR').toUpperCase();

  const isCrossCurrency = fromCur !== toCur;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;

    if (!canTransfer) {
      setErr('Your role does not allow creating wallet transfers.');
      return;
    }

    const numAmount = Number(amount);
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      setErr('Please enter a transfer amount greater than 0.');
      return;
    }

    if (!fromId || !toId) {
      setErr('Please select both source and destination accounts.');
      return;
    }

    if (fromId === toId) {
      setErr('Source and destination accounts must be different.');
      return;
    }

    setBusy(true);
    setErr('');

    try {
      const payload = {
        from_wallet_id: fromId,
        to_wallet_id: toId,
        amount: numAmount,
        description: description.trim() || undefined,
        transfer_id: transferId,
      };

      const res = await apiFetch('/wallets/transfer', token, {
        method: 'POST',
        body: payload
      });

      if (res && res.error) {
        throw new Error(res.message || res.error);
      }

      if (onSuccess) onSuccess(res);
      if (onClose) onClose();
    } catch (error) {
      setErr(error.message || 'Failed to complete wallet transfer.');
    } finally {
      setBusy(false);
    }
  };

  const field = {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 9,
    fontSize: 14,
    border: '1px solid var(--border-default, #d0d7de)',
    background: 'var(--surface-card, #ffffff)',
    color: 'var(--text-primary, #1f2328)',
    boxSizing: 'border-box'
  };
  const label = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary, #4a5563)',
    marginBottom: 5
  };

  return (
    <div className="cfo-modal-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
      <div className="cfo-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 id="transfer-modal-title" style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--brand-navy, #003366)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Transfer between accounts
            <InfoTooltip term="internal_transfer" />
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close transfer modal"
            style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--text-muted, #656d76)' }}
          >
            ✕
          </button>
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--text-muted, #656d76)', marginBottom: 16, lineHeight: 1.5 }}>
          Atomic double-entry movement between business accounts. Internal transfers do not change total company cash or operating expenses.
        </div>

        {!canTransfer && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: '#ffebe9', color: '#cf222e', fontSize: 12.5, marginBottom: 14 }}>
            Your workspace role is view-only. You cannot execute financial transfers.
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
          <div>
            <span style={label}>From account</span>
            <select
              style={field}
              value={fromId}
              onChange={e => setFromId(e.target.value)}
              disabled={busy || !canTransfer}
              id="transfer-from-wallet"
            >
              {activeWallets.map(w => (
                <option key={w.id} value={w.id} disabled={w.id === toId}>
                  {w.name} ({w.currency || 'IDR'}) · Balance: {formatAmount(String(w.balance ?? 0), w.currency || 'IDR')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span style={label}>To account</span>
            <select
              style={field}
              value={toId}
              onChange={e => setToId(e.target.value)}
              disabled={busy || !canTransfer}
              id="transfer-to-wallet"
            >
              <option value="">— Select destination —</option>
              {activeWallets.map(w => (
                <option key={w.id} value={w.id} disabled={w.id === fromId}>
                  {w.name} ({w.currency || 'IDR'}) · Balance: {formatAmount(String(w.balance ?? 0), w.currency || 'IDR')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span style={label}>
              Amount ({fromCur})
            </span>
            <input
              type="number"
              step="any"
              min="0.01"
              style={field}
              placeholder={`Enter amount in ${fromCur}`}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              disabled={busy || !canTransfer}
              id="transfer-amount-input"
            />
          </div>

          {isCrossCurrency && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--info-soft, #eff6ff)', fontSize: 12, color: 'var(--text-secondary, #4a5563)', lineHeight: 1.45 }}>
              Cross-currency transfer ({fromCur} → {toCur}). Booked rate will be calculated atomically using JISDOR / FX quote at execution date.
              <InfoTooltip term="fx_revaluation" />
            </div>
          )}

          <div>
            <span style={label}>Description / Reference (optional)</span>
            <input
              type="text"
              style={field}
              placeholder="e.g. Funding payroll sub-account"
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={busy || !canTransfer}
              id="transfer-desc-input"
            />
          </div>

          {err && (
            <div style={{ fontSize: 13, color: 'var(--danger, #cf222e)', background: '#ffebe9', padding: '8px 12px', borderRadius: 8 }}>
              {err}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <Btn variant="ghost" onClick={onClose} disabled={busy} type="button">Cancel</Btn>
            <Btn onClick={handleSubmit} disabled={busy || !canTransfer || !fromId || !toId || fromId === toId || !amount} id="transfer-submit-btn">
              {busy ? 'Transferring…' : 'Execute transfer'}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
