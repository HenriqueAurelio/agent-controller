import {
  DEFAULT_LAYOUT,
  PANEL_PLACES,
  SIDES,
  type Layout,
  type PanelPlace,
  type Side,
} from '@shared/layout';

interface Props {
  layout: Layout;
  onChange(layout: Layout): void;
}

const SESSIONS_LABEL: Record<Side, string> = {
  left: 'À esquerda',
  right: 'À direita',
  top: 'Em cima',
  bottom: 'Embaixo',
};
const PANEL_LABEL: Record<PanelPlace, string> = {
  cover: 'Por cima do terminal',
  left: 'À esquerda do terminal',
  right: 'À direita do terminal',
  top: 'Em cima do terminal',
  bottom: 'Embaixo do terminal',
};
const FILES_LABEL: Record<Side, string> = {
  left: 'À esquerda do texto',
  right: 'À direita do texto',
  top: 'Em cima do texto',
  bottom: 'Embaixo do texto',
};

/** Where the sessions, the panel and its list of files go, with a miniature of the result. */
export function LayoutEditor({ layout, onChange }: Props) {
  const select = <K extends keyof Layout>(
    key: K,
    label: string,
    options: readonly Layout[K][],
    labels: Record<Layout[K], string>,
  ) => (
    <label className="field-inline layout-option">
      <span>{label}</span>
      <select
        aria-label={label}
        value={layout[key]}
        onChange={(e) => onChange({ ...layout, [key]: e.target.value as Layout[K] })}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </label>
  );

  const isDefault = (Object.keys(DEFAULT_LAYOUT) as (keyof Layout)[]).every(
    (key) => layout[key] === DEFAULT_LAYOUT[key],
  );

  return (
    <>
      <fieldset className="field">
        <legend>Onde fica cada parte</legend>
        {select('sessions', 'Sessões', SIDES, SESSIONS_LABEL)}
        {select('panel', 'Painel de mudanças e arquivos', PANEL_PLACES, PANEL_LABEL)}
        {select('files', 'Lista de arquivos do painel', SIDES, FILES_LABEL)}
      </fieldset>

      <fieldset className="field">
        <legend>Como fica, com o painel aberto</legend>
        <div className="layout-preview" data-sessions={layout.sessions} aria-hidden="true">
          <div className="layout-part layout-sessions">Sessões</div>
          <div className="layout-main" data-panel={layout.panel}>
            <div className="layout-part layout-terminal">Terminal</div>
            <div className="layout-panel" data-files={layout.files}>
              <div className="layout-part layout-files">Arquivos</div>
              <div className="layout-part layout-text">Texto</div>
            </div>
          </div>
        </div>
      </fieldset>

      <div className="shortcut-footer">
        <span className="muted">A mudança vale na hora.</span>
        <button type="button" disabled={isDefault} onClick={() => onChange(DEFAULT_LAYOUT)}>
          Restaurar padrão
        </button>
      </div>
    </>
  );
}
