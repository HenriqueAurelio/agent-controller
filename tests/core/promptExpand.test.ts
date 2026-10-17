import { describe, expect, it } from 'vitest';
import { expandPrompt, promptQuestions, promptVariables } from '@core/prompts/expand';
import { DEFAULT_SHORTCUTS } from '@shared/shortcuts';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '@shared/prefs';
import {
  factoryPrompts,
  newPromptId,
  PROMPT_TEXT_LIMIT,
  PROMPTS_LIMIT,
  sanitizePrompts,
} from '@shared/prompts';
import { LANGUAGES } from '@shared/i18n';

const VARIABLES = {
  session: 'API',
  folder: '/home/ana/api',
  branch: 'main',
  file: 'src/soma.ts',
  selection: 'return a - b;',
};

describe('expandPrompt', () => {
  it('fills in every variable, by its Portuguese name or its English one', () => {
    expect(
      expandPrompt(
        'Sessão {sessao} em {pasta} ({branch}): olhe {arquivo}, trecho {selecao}.',
        VARIABLES,
      ),
    ).toBe('Sessão API em /home/ana/api (main): olhe src/soma.ts, trecho return a - b;.');
    expect(
      expandPrompt('{session} {folder} {file} {selection} {sessão} {seleção}', VARIABLES),
    ).toBe('API /home/ana/api src/soma.ts return a - b; API return a - b;');
  });

  it('keeps an unknown variable and braces that are code as they were written', () => {
    const text = 'Use {desconhecida} e mantenha `if (x) { return {a: 1}; }` e {} e {1abc}.';
    expect(expandPrompt(text, VARIABLES)).toBe(text);
  });

  it('turns a variable with no value into nothing', () => {
    expect(expandPrompt('[{arquivo}] [{branch}]', { session: 'x' })).toBe('[] []');
  });

  it('fills in the questions with the answers, and an unanswered one with nothing', () => {
    const text =
      'Corrija {? O que falhou?} no {arquivo}. Prioridade: {?Prioridade}. {?O que falhou?}';
    expect(promptQuestions(text)).toEqual(['O que falhou?', 'Prioridade']);
    expect(expandPrompt(text, VARIABLES, { 'O que falhou?': 'o teste de soma' })).toBe(
      'Corrija o teste de soma no src/soma.ts. Prioridade: . o teste de soma',
    );
  });

  it('does not read a value as a variable: the expansion happens once', () => {
    expect(expandPrompt('{arquivo}', { ...VARIABLES, file: '{pasta}' })).toBe('{pasta}');
    expect(expandPrompt('{selecao}', { ...VARIABLES, selection: '$& $1 $$' })).toBe('$& $1 $$');
  });

  it('tells which known variables a prompt uses', () => {
    expect(promptVariables('{branch} {Arquivo} {x} {?y}')).toEqual(['branch', 'file']);
    expect(promptVariables('sem variáveis')).toEqual([]);
  });
});

describe('saved prompts', () => {
  it('come from the factory in each language, with the same ids', () => {
    for (const language of LANGUAGES) {
      const prompts = factoryPrompts(language);
      expect(prompts.map((p) => p.id)).toEqual([
        'review-diff',
        'write-tests',
        'update-readme',
        'review-turn',
      ]);
      for (const prompt of prompts) expect(prompt.name && prompt.text).toBeTruthy();
    }
    expect(factoryPrompts('en')[0]!.name).not.toBe(factoryPrompts('pt-BR')[0]!.name);
    // The test prompt asks for the file of the panel.
    expect(promptVariables(factoryPrompts('pt-BR')[1]!.text)).toContain('file');
  });

  it('are the factory ones when the preferences predate them, and kept as left otherwise', () => {
    expect(sanitizePreferences({ language: 'en' }).prompts).toEqual(factoryPrompts('en'));
    expect(sanitizePreferences({ prompts: [] }).prompts).toEqual([]);
    expect(DEFAULT_PREFERENCES.promptSubmit).toBe(false);
    expect(sanitizePreferences({ promptSubmit: 'yes' as never }).promptSubmit).toBe(false);
  });

  it('drop what is not a prompt, repeated ids, and what is too long', () => {
    const prompts = sanitizePrompts(
      [
        { id: 'a', name: '  Revisar  ', text: 'x' },
        { id: 'a', name: 'Repetido', text: 'y' },
        { id: 'com espaço', name: 'Id inválido', text: 'z' },
        { id: 'b', name: '', text: 'sem nome' },
        { id: 'c', name: 'Longo', text: 'x'.repeat(PROMPT_TEXT_LIMIT + 1) },
        { id: 'd', name: 'N'.repeat(500), text: '' },
        'texto solto',
        null,
      ],
      'pt-BR',
    );
    expect(prompts.map((p) => [p.id, p.name.length])).toEqual([
      ['a', 'Revisar'.length],
      ['d', 80],
    ]);
    const many = Array.from({ length: PROMPTS_LIMIT + 5 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      text: '',
    }));
    expect(sanitizePrompts(many, 'pt-BR')).toHaveLength(PROMPTS_LIMIT);
  });

  it('keep a shortcut only when it is valid and no action or other prompt has it', () => {
    const prefs = sanitizePreferences({
      prompts: [
        { id: 'a', name: 'A', text: '', shortcut: 'ctrl+alt+r' },
        { id: 'b', name: 'B', text: '', shortcut: 'Ctrl+Alt+R' },
        { id: 'c', name: 'C', text: '', shortcut: DEFAULT_SHORTCUTS.palette[0] },
        { id: 'd', name: 'D', text: '', shortcut: 'R' },
      ],
    });
    expect(prefs.prompts.map((p) => p.shortcut)).toEqual([
      'Ctrl+Alt+R',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('get an id no other prompt has', () => {
    expect(newPromptId([])).toBe('prompt-1');
    expect(
      newPromptId([
        { id: 'prompt-2', name: 'a', text: '' },
        { id: 'prompt-3', name: 'b', text: '' },
      ]),
    ).toBe('prompt-4');
  });
});
