import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, PANEL_PLACES, SIDES, sanitizeLayout } from '@shared/layout';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '@shared/prefs';

describe('layout', () => {
  it('keeps every combination of places', () => {
    for (const sessions of SIDES) {
      for (const panel of PANEL_PLACES) {
        for (const files of SIDES) {
          expect(sanitizeLayout({ sessions, panel, files })).toEqual({ sessions, panel, files });
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
