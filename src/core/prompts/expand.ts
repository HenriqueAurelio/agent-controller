// Fills in the variables of a saved prompt. Pure: what each variable is worth is decided by
// whoever calls (the main process knows the folder and branch, the renderer the open file).
import { PROMPT_VARIABLE as VARIABLE } from '@shared/prompts';

export { promptQuestions } from '@shared/prompts';

export interface PromptVariables {
  session: string;
  folder: string;
  branch: string;
  file: string;
  selection: string;
  problems: string;
}

/** Each variable under its Portuguese name, as the prompts are written, and in English. */
const NAMES: Record<string, keyof PromptVariables> = {
  sessao: 'session',
  sessão: 'session',
  session: 'session',
  pasta: 'folder',
  folder: 'folder',
  branch: 'branch',
  arquivo: 'file',
  file: 'file',
  selecao: 'selection',
  seleção: 'selection',
  selection: 'selection',
  problemas: 'problems',
  problems: 'problems',
};

/** Which of the known variables a prompt uses. */
export function promptVariables(text: string): (keyof PromptVariables)[] {
  const used = new Set<keyof PromptVariables>();
  for (const match of text.matchAll(VARIABLE)) {
    const variable = NAMES[match[1]!.toLowerCase()];
    if (variable) used.add(variable);
  }
  return [...used];
}

/**
 * The prompt with its variables replaced. An unknown variable stays as it was written, and a
 * question with no answer becomes empty.
 */
export function expandPrompt(
  text: string,
  variables: Partial<PromptVariables>,
  answers: Readonly<Record<string, string>> = {},
): string {
  return text.replace(VARIABLE, (whole, name: string) => {
    if (name.startsWith('?')) return answers[name.slice(1).trim()] ?? '';
    const variable = NAMES[name.toLowerCase()];
    if (!variable) return whole;
    return variables[variable] ?? '';
  });
}
