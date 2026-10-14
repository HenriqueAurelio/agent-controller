import { useEffect } from 'react';
import { isFavoriteFolder, toggleFavoriteFolder } from '@shared/prefs';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';

interface Props {
  value: string;
  onChange(folder: string): void;
  placeholder: string;
}

const SHOWN = 5;

/** A folder: typed, picked in the native dialog, or taken from the favorites and the latest used. */
export function FolderField({ value, onChange, placeholder }: Props) {
  const t = useT();
  const testMode = useAppState((s) => s.info.testMode);
  const favorites = useAppState((s) => s.prefs.favoriteFolders);
  const recent = useAppState((s) => s.recentFolders);

  // Already known when the field appears; asked again in case a folder is gone from the disk.
  useEffect(() => void store.refreshRecentFolders(true), []);

  const pickFolder = async () => {
    const folder = await window.api.invoke('dialog:pickFolder', value || undefined);
    if (folder) onChange(folder);
  };

  const folder = value.trim();
  const favorite = isFavoriteFolder(favorites, folder);
  const offered = recent
    .filter((other) => other !== value && !isFavoriteFolder(favorites, other))
    .slice(0, SHOWN);

  const list = (label: string, folders: string[], mark: string) =>
    folders.length > 0 && (
      <ul className="recent-folders" aria-label={label}>
        {folders.map((other) => (
          <li key={other}>
            <button
              type="button"
              className={`recent-folder ${other === folder ? 'chosen' : ''}`}
              title={other}
              onClick={() => onChange(other)}
            >
              <span className="recent-mark" aria-hidden="true">
                {mark}
              </span>
              {other}
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="field">
      <label className="field">
        <span>{t('common.folder')}</span>
        <div className="field-row">
          <input
            data-autofocus
            aria-label={t('common.folder')}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            className={favorite ? 'favorite-toggle on' : 'favorite-toggle'}
            aria-pressed={favorite}
            aria-label={favorite ? t('folder.unfavorite') : t('folder.favorite')}
            title={favorite ? t('folder.unfavoriteHint') : t('folder.favoriteHint')}
            disabled={!folder}
            onClick={() =>
              void window.api.invoke('prefs:set', {
                favoriteFolders: toggleFavoriteFolder(favorites, folder),
              })
            }
          >
            {favorite ? '★' : '☆'}
          </button>
          {/* In test mode the native folder dialog cannot be driven; the path is typed. */}
          {!testMode && (
            <button type="button" onClick={pickFolder}>
              {t('common.choose')}
            </button>
          )}
        </div>
      </label>
      {list(t('folder.favorites'), favorites, '★')}
      {list(t('folder.recent'), offered, '↺')}
    </div>
  );
}
