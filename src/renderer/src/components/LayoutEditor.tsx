import {
  AUX_PLACES,
  DEFAULT_LAYOUT,
  PANEL_PLACES,
  SIDES,
  type AuxPlace,
  type Layout,
  type PanelPlace,
  type Side,
} from '@shared/layout';
import { useT } from '../lib/i18n';

interface Props {
  layout: Layout;
  onChange(layout: Layout): void;
}

/** Where the sessions, the panel and its list of files go, with a miniature of the result. */
export function LayoutEditor({ layout, onChange }: Props) {
  const t = useT();
  const select = <K extends keyof Layout>(
    key: K,
    label: string,
    options: readonly Layout[K][],
    optionLabel: (option: Layout[K]) => string,
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
            {optionLabel(option)}
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
        <legend>{t('layout.where')}</legend>
        {select('sessions', t('common.sessions'), SIDES, (side: Side) =>
          t(`layout.sessions.${side}`),
        )}
        {select('panel', t('layout.panelLabel'), PANEL_PLACES, (place: PanelPlace) =>
          t(`layout.panel.${place}`),
        )}
        {select('files', t('layout.filesLabel'), SIDES, (side: Side) => t(`layout.files.${side}`))}
        {select('aux', t('layout.auxLabel'), AUX_PLACES, (place: AuxPlace) =>
          t(`layout.aux.${place}`),
        )}
      </fieldset>

      <fieldset className="field">
        <legend>{t('layout.preview')}</legend>
        <div className="layout-preview" data-sessions={layout.sessions} aria-hidden="true">
          <div className="layout-part layout-sessions">{t('common.sessions')}</div>
          <div className="layout-main" data-panel={layout.panel}>
            <div className="layout-terminals" data-aux={layout.aux}>
              <div className="layout-part layout-terminal">{t('layout.terminal')}</div>
              <div className="layout-part layout-aux">{t('layout.auxShort')}</div>
            </div>
            <div className="layout-panel" data-files={layout.files}>
              <div className="layout-part layout-files">{t('common.files')}</div>
              <div className="layout-part layout-text">{t('layout.text')}</div>
            </div>
          </div>
        </div>
      </fieldset>

      <div className="shortcut-footer">
        <span className="muted">{t('layout.immediate')}</span>
        <button type="button" disabled={isDefault} onClick={() => onChange(DEFAULT_LAYOUT)}>
          {t('layout.restore')}
        </button>
      </div>
    </>
  );
}
