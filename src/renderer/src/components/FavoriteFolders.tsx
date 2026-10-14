import { useState } from 'react';
import { isFavoriteFolder, toggleFavoriteFolder } from '@shared/prefs';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';

/** The favorite folders, in the preferences: the ones offered first when a session is created. */
export function FavoriteFolders() {
  const favorites = useAppState((s) => s.prefs.favoriteFolders);
  const testMode = useAppState((s) => s.info.testMode);
  const t = useT();
  const [typed, setTyped] = useState('');

  const save = (favoriteFolders: string[]) =>
    void window.api.invoke('prefs:set', { favoriteFolders });
  const add = (folder: string) => {
    const clean = folder.trim();
    if (clean && !isFavoriteFolder(favorites, clean)) save(toggleFavoriteFolder(favorites, clean));
    setTyped('');
  };

  return (
    <div className="favorite-folders">
      <span className="muted">{t('favorites.hint')}</span>
      {favorites.length > 0 && (
        <ul className="favorite-list" aria-label={t('favorites.list')}>
          {favorites.map((folder) => (
            <li key={folder}>
              <span className="favorite-path" title={folder}>
                {folder}
              </span>
              <button
                type="button"
                className="shortcut-remove"
                aria-label={t('favorites.removeOne', { folder })}
                title={t('folder.unfavorite')}
                onClick={() => save(toggleFavoriteFolder(favorites, folder))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="field-row">
        <input
          aria-label={t('favorites.new')}
          placeholder={t('favorites.placeholder')}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            add(typed);
          }}
        />
        <button type="button" disabled={!typed.trim()} onClick={() => add(typed)}>
          {t('common.add')}
        </button>
        {!testMode && (
          <button
            type="button"
            onClick={async () => {
              const folder = await window.api.invoke('dialog:pickFolder');
              if (folder) add(folder);
            }}
          >
            {t('common.choose')}
          </button>
        )}
      </div>
    </div>
  );
}
