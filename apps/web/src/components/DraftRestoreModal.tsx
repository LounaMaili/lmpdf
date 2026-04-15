import type { DraftRecord } from '../api';
import { useTranslation } from '../i18n';

interface DraftRestoreModalProps {
  draft: DraftRecord;
  onRestore: () => void;
  onIgnore: () => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DraftRestoreModal({ draft, onRestore, onIgnore }: DraftRestoreModalProps) {
  const { t } = useTranslation();
  const payload = draft.payload as any;
  const fieldCount = payload?.fields?.length ?? 0;

  return (
    <div className="modal-backdrop" onClick={onIgnore}>
      <div className="modal-content draft-restore-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('draft.title')}</h3>
        <p>
          {t('draft.description')}{' '}
          <strong>{formatDateTime(draft.updatedAt)}</strong>.
        </p>
        {fieldCount > 0 && (
          <p className="draft-detail">
            {t('draft.fieldCount', { count: fieldCount, name: payload?.name || t('draft.unnamed') })}
          </p>
        )}
        <div className="draft-restore-actions">
          <button className="btn-primary" onClick={onRestore}>
            {t('draft.restore')}
          </button>
          <button className="btn-secondary" onClick={onIgnore}>
            {t('draft.ignore')}
          </button>
        </div>
      </div>
    </div>
  );
}
