// The commands of the palette (Ctrl+Shift+P): what can be done right now, for the session in
// sight, its group, the saved prompts and the code themes. Pure: App.tsx gives the state and the
// actions, and keeps the list in a useMemo.
import type { SessionGroup, SessionView } from '@shared/session';
import type { Preferences } from '@shared/prefs';
import type { PromptTemplate } from '@shared/prompts';
import type { ShortcutAction } from '@shared/shortcuts';
import type { Command } from '../components/CommandPalette';
import type { PanelMode } from '../components/ChangesPanel';
import type { TerminalAreaHandle } from '../components/TerminalArea';
import { codeThemeName, themesOfKind } from './codeThemes';
import type { Translate } from '@shared/i18n';
import { store } from './store';

/** The dialogs a command of the palette opens. */
export type CommandOverlay = 'experiment' | 'branch' | 'checks' | 'reviewer' | 'queue' | 'timeline';

export interface CommandsInput {
  t: Translate;
  sessions: SessionView[];
  groups: SessionGroup[];
  selected: SessionView | null;
  shortcuts: Preferences['shortcuts'];
  prompts: PromptTemplate[];
  theme: Parameters<typeof themesOfKind>[0];
  customThemes: Parameters<typeof themesOfKind>[1];
  metrics: ReturnType<typeof store.get>['metrics'];
  runAction(action: ShortcutAction): void;
  showPanel(mode: PanelMode): void;
  requestClose(session: SessionView): void;
  changeFolder(): void;
  duplicate(session: SessionView): void;
  openPrompt(promptId?: string): void;
  editGroup(group?: SessionGroup): void;
  runSonar(sessionId: string): void;
  openOverlay(overlay: CommandOverlay): void;
  /** The board, with the dialog of a new card open. */
  openNewTask(): void;
  openPreview(url: string): void;
  terminals(): TerminalAreaHandle | null;
}

export function buildCommands({
  t,
  sessions,
  groups,
  selected,
  shortcuts,
  prompts,
  theme,
  customThemes,
  metrics,
  runAction,
  showPanel,
  requestClose,
  changeFolder,
  duplicate,
  openPrompt,
  editGroup,
  runSonar,
  openOverlay,
  openNewTask,
  openPreview,
  terminals,
}: CommandsInput): Command[] {
  const action = (id: ShortcutAction, title?: string, run?: () => void): Command => ({
    id,
    title: title ?? t(`shortcut.${id}`),
    shortcut: shortcuts[id][0],
    run: run ?? (() => runAction(id)),
  });
  const list: Command[] = [
    action('newSession'),
    action('nextSession'),
    action('prevSession'),
    action('nextWaiting'),
    action('overview'),
    action('board'),
    action('pulls'),
    action('background'),
    {
      id: 'new-task',
      title: t('command.newTask'),
      run: openNewTask,
    },
    action('focusSidebar'),
    action('preferences'),
    action('newGroup', t('command.newGroup')),
    {
      id: 'new-experiment',
      title: t('command.newExperiment'),
      run: () => openOverlay('experiment'),
    },
  ];
  for (const group of groups) {
    list.push({
      id: `edit-group-${group.id}`,
      title: t('command.editGroup', { name: group.name }),
      run: () => editGroup(group),
    });
  }
  if (selected) {
    list.unshift(
      action('toggleChanges', t('command.seeChanges'), () => showPanel('changes')),
      action('toggleFiles', t('command.files'), () => showPanel('files')),
      action('search', t('command.search'), () => showPanel('search')),
      {
        id: 'show-problems',
        title: t('command.problems'),
        run: () => showPanel('problems'),
      },
      {
        id: 'show-all',
        title: t('command.all'),
        run: () => showPanel('all'),
      },
      ...(selected.worktree
        ? [
            {
              id: 'branch-pull',
              title: t('command.branchPull', { name: selected.name }),
              run: () => openOverlay('branch'),
            },
          ]
        : []),
      {
        id: 'new-conversation',
        title: t('command.newConversation', { name: selected.name }),
        run: () => void window.api.invoke('sessions:newConversation', selected.id).catch(() => {}),
      },
      {
        id: 'preview-open',
        title: t('command.preview'),
        run: () => {
          const port = metrics[selected.id]?.ports?.[0];
          openPreview(`http://localhost:${port ?? 3000}`);
        },
      },
      {
        id: 'sonar-run',
        title: t('command.sonarRun', { name: selected.name }),
        run: () => runSonar(selected.id),
      },
      {
        id: 'show-review',
        title: t('command.review'),
        run: () => showPanel('review'),
      },
      action('quickOpen', t('command.quickOpen')),
      action('toggleHidden', t('command.toggleHidden')),
      action(
        'toggleAux',
        t(selected.auxOpen ? 'command.closeAux' : 'command.openAux', { name: selected.name }),
      ),
    );
    if (selected.permission && selected.running) {
      list.unshift(action('allowPermission'), action('denyPermission'));
    }
    if (selected.auxOpen) {
      list.push(
        {
          id: 'aux-grow',
          title: t('command.auxGrow'),
          run: () => terminals()?.resizeAux(1),
        },
        {
          id: 'aux-shrink',
          title: t('command.auxShrink'),
          run: () => terminals()?.resizeAux(-1),
        },
      );
    }
    list.push(
      selected.running
        ? {
            id: 'stop',
            title: t('command.stop', { name: selected.name }),
            run: () => void window.api.invoke('sessions:stop', selected.id),
          }
        : {
            id: 'start',
            title: t('command.start', { name: selected.name }),
            run: () => terminals()?.start(selected.id),
          },
      {
        id: 'folder',
        title: t('command.changeFolder', { name: selected.name }),
        run: changeFolder,
      },
      {
        id: 'checks',
        title: t('command.checks', { name: selected.name }),
        run: () => openOverlay('checks'),
      },
      {
        id: 'run-checks',
        title: t('command.runChecks', { name: selected.name }),
        run: () => void window.api.invoke('checks:run', selected.id),
      },
      {
        id: 'reviewer',
        title: t('command.reviewer', { name: selected.name }),
        run: () => openOverlay('reviewer'),
      },
      {
        id: 'queue',
        title: t('command.queue', { name: selected.name }),
        run: () => openOverlay('queue'),
      },
      {
        id: 'timeline',
        title: t('command.timeline', { name: selected.name }),
        run: () => openOverlay('timeline'),
      },
      {
        id: 'duplicate',
        title: t('command.duplicate', { name: selected.name }),
        run: () => duplicate(selected),
      },
      {
        id: 'close',
        title: t('command.close', { name: selected.name }),
        run: () => requestClose(selected),
      },
    );
    for (const group of groups) {
      if (group.id === selected.groupId) {
        list.push({
          id: `leave-group-${group.id}`,
          title: t('command.leaveGroup', { name: selected.name, group: group.name }),
          run: () => void store.moveToGroup(selected.id, null),
        });
      } else {
        list.push({
          id: `move-to-group-${group.id}`,
          title: t('command.moveToGroup', { name: selected.name, group: group.name }),
          run: () => void store.moveToGroup(selected.id, group.id),
        });
      }
    }
  }
  if (prompts.length > 0) list.push(action('sendPrompt'));
  for (const prompt of prompts) {
    list.push({
      id: `prompt-${prompt.id}`,
      title: t('command.prompt', { name: prompt.name }),
      shortcut: prompt.shortcut,
      run: () => openPrompt(prompt.id),
    });
  }
  // The code themes of the current kind, to switch from the keyboard.
  for (const codeTheme of themesOfKind(theme, customThemes)) {
    list.push({
      id: `code-theme-${codeTheme.id}`,
      title: t('command.codeTheme', { name: codeThemeName(t, codeTheme) }),
      run: () =>
        void window.api.invoke('prefs:set', {
          [theme === 'light' ? 'codeThemeLight' : 'codeThemeDark']: codeTheme.id,
        }),
    });
  }
  sessions.forEach((s, i) =>
    list.push({
      id: `go-${s.id}`,
      title: t('command.goTo', { name: s.name }),
      shortcut: i < 9 ? `Ctrl+${i + 1}` : undefined,
      run: () => store.select(s.id),
    }),
  );
  return list;
}
