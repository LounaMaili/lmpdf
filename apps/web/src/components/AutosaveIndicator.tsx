import type { AutosaveStatus } from '../hooks/useAutosave';
import { useTranslation } from '../i18n';

interface AutosaveIndicatorProps {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  errorMessage: string | null;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AutosaveIndicator({ status, lastSavedAt, errorMessage }: AutosaveIndicatorProps) {
  const { t } = useTranslation();

  if (status === 'idle' && !lastSavedAt) return null;

  let content: string;
  let className = 'autosave-indicator';

  switch (status) {
    case 'saving':
      content = t('autosave.saving');
      className += ' autosave-saving';
      break;
    case 'saved':
      content = t('autosave.saved', { time: lastSavedAt ? formatTime(lastSavedAt) : '' });
      className += ' autosave-saved';
      break;
    case 'error':
      content = errorMessage
        ? t('autosave.errorWithMessage', { message: errorMessage })
        : t('autosave.error');
      className += ' autosave-error';
      break;
    default:
      if (lastSavedAt) {
        content = t('autosave.draftSaved', { time: formatTime(lastSavedAt) });
        className += ' autosave-saved';
      } else {
        return null;
      }
  }

  return (
    <div className={className} title={errorMessage || undefined}>
      {content}
    </div>
  );
}
