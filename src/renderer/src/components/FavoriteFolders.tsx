import { useState } from 'react';
import { isFavoriteFolder, toggleFavoriteFolder } from '@shared/prefs';
import { useAppState } from '../lib/store';

/** The favorite folders, in the preferences: the ones offered first when a session is created. */
export function FavoriteFolders() {
  const favorites = useAppState((s) => s.prefs.favoriteFolders);
  const testMode = useAppState((s) => s.info.testMode);
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
      <span className="muted">Pastas favoritas, oferecidas ao criar uma sessão</span>
      {favorites.length > 0 && (
        <ul className="favorite-list" aria-label="Pastas favoritas">
          {favorites.map((folder) => (
            <li key={folder}>
              <span className="favorite-path" title={folder}>
                {folder}
              </span>
              <button
                type="button"
                className="shortcut-remove"
                aria-label={`Tirar ${folder} dos favoritos`}
                title="Tirar dos favoritos"
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
          aria-label="Nova pasta favorita"
          placeholder="Caminho de uma pasta"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            add(typed);
          }}
        />
        <button type="button" disabled={!typed.trim()} onClick={() => add(typed)}>
          Adicionar
        </button>
        {!testMode && (
          <button
            type="button"
            onClick={async () => {
              const folder = await window.api.invoke('dialog:pickFolder');
              if (folder) add(folder);
            }}
          >
            Escolher…
          </button>
        )}
      </div>
    </div>
  );
}
