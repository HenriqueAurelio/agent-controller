import { useMemo, useState } from 'react';
import { useT } from '../lib/i18n';
import { Dialog } from './Dialog';

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  run(): void;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose(): void }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => words.every((w) => c.title.toLowerCase().includes(w)));
  }, [commands, query]);
  const active = Math.min(index, Math.max(0, matches.length - 1));

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <Dialog title={t('shortcut.palette')} onClose={onClose} className="palette">
      <input
        data-autofocus
        aria-label={t('palette.input')}
        placeholder={t('palette.placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex(Math.min(matches.length - 1, active + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex(Math.max(0, active - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            run(matches[active]);
          }
        }}
      />
      <ul className="palette-list" role="listbox">
        {matches.map((command, i) => (
          <li
            key={command.id}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'active' : ''}
            onMouseEnter={() => setIndex(i)}
            onClick={() => run(command)}
          >
            <span>{command.title}</span>
            {command.shortcut && <kbd>{command.shortcut}</kbd>}
          </li>
        ))}
        {matches.length === 0 && <li className="muted">{t('palette.empty')}</li>}
      </ul>
    </Dialog>
  );
}
