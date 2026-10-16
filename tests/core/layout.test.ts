import { describe, expect, it } from 'vitest';
import { AUX_PLACES, DEFAULT_LAYOUT, PANEL_PLACES, SIDES, sanitizeLayout } from '@shared/layout';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '@shared/prefs';

describe('layout', () => {
  it('keeps every combination of places', () => {
    for (const sessions of SIDES) {
      for (const panel of PANEL_PLACES) {
        for (const files of SIDES) {
          for (const aux of AUX_PLACES) {
            const layout = { sessions, panel, files, aux };
            expect(sanitizeLayout(layout)).toEqual(layout);
          }
        }
      }
    }
  });

  it('falls back to the default, part by part, on anything it does not know', () => {
    for (const garbage of [undefined, null, 'left', 7, []]) {
      expect(sanitizeLayout(garbage)).toEqual(DEFAULT_LAYOUT);
    }
    expect(sanitizeLayout({ sessions: 'bottom', panel: 'middle', files: 3 })).toEqual({
      ...DEFAULT_LAYOUT,
      sessions: 'bottom',
    });
    // The sessions have no "cover": that is a place of the panel only.
    expect(sanitizeLayout({ sessions: 'cover', panel: 'cover' })).toEqual(DEFAULT_LAYOUT);
    // The side terminal goes below or to the right of the agent, nowhere else.
    expect(sanitizeLayout({ aux: 'left' })).toEqual(DEFAULT_LAYOUT);
    // Layouts saved before the side terminal existed get its default place.
    expect(sanitizeLayout({ sessions: 'top', panel: 'right', files: 'left' }).aux).toBe('bottom');
  });

  it('is part of the preferences, and survives preferences saved before it existed', () => {
    expect(DEFAULT_PREFERENCES.layout).toEqual(DEFAULT_LAYOUT);
    const { layout: _layout, ...old } = DEFAULT_PREFERENCES;
    expect(sanitizePreferences(old).layout).toEqual(DEFAULT_LAYOUT);
    expect(
      sanitizePreferences({ ...old, layout: { ...DEFAULT_LAYOUT, panel: 'right' } }).layout.panel,
    ).toBe('right');
  });
});
