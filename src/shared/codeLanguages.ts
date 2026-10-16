/**
 * Which grammar colors a file. The ids are the ones of the TextMate grammars the changes panel
 * loads (Shiki's); `monarch` is the Monaco grammar used when the TextMate one cannot be (no
 * grammar, failed to load, file too large). Names are matched without case on every system.
 */
export interface CodeLanguage {
  id: string;
  /** Proper name of the language, the same in every language of the app. */
  name: string;
  /** Extensions, without the dot. */
  extensions?: readonly string[];
  /** Whole file names; a trailing `*` matches the start of the name. */
  fileNames?: readonly string[];
  monarch?: string;
  /** Line comment, for the editor's "toggle comment" when there is no Monaco grammar. */
  comment?: string;
}

const L = (
  id: string,
  name: string,
  extensions: string[] = [],
  extra: Omit<CodeLanguage, 'id' | 'name' | 'extensions'> = {},
): CodeLanguage => ({ id, name, extensions, ...extra });

export const CODE_LANGUAGES = [
  L('typescript', 'TypeScript', ['ts', 'mts', 'cts'], { monarch: 'typescript' }),
  L('tsx', 'TypeScript JSX', ['tsx'], { monarch: 'typescript' }),
  L('javascript', 'JavaScript', ['js', 'mjs', 'cjs'], { monarch: 'javascript' }),
  L('jsx', 'JavaScript JSX', ['jsx'], { monarch: 'javascript' }),
  L('json', 'JSON', ['json', 'webmanifest'], { fileNames: ['.babelrc', '.prettierrc'] }),
  L('jsonc', 'JSON with Comments', ['jsonc'], {
    fileNames: [
      'tsconfig.json',
      'tsconfig.*',
      'jsconfig.json',
      '.eslintrc.json',
      'devcontainer.json',
    ],
    comment: '//',
  }),
  L('json5', 'JSON5', ['json5'], { comment: '//' }),
  L('jsonl', 'JSON Lines', ['jsonl', 'ndjson']),
  L('markdown', 'Markdown', ['md', 'markdown', 'mdown', 'mkd'], { monarch: 'markdown' }),
  L('mdx', 'MDX', ['mdx'], { monarch: 'mdx' }),
  L('html', 'HTML', ['html', 'htm', 'xhtml'], { monarch: 'html' }),
  L('css', 'CSS', ['css'], { monarch: 'css' }),
  L('scss', 'SCSS', ['scss'], { monarch: 'scss' }),
  L('sass', 'Sass', ['sass'], { comment: '//' }),
  L('less', 'Less', ['less'], { monarch: 'less' }),
  L('postcss', 'PostCSS', ['pcss', 'postcss'], { monarch: 'css' }),
  L('stylus', 'Stylus', ['styl', 'stylus'], { comment: '//' }),
  L('vue', 'Vue', ['vue'], { monarch: 'html' }),
  L('svelte', 'Svelte', ['svelte'], { monarch: 'html' }),
  L('astro', 'Astro', ['astro'], { monarch: 'html' }),
  L('python', 'Python', ['py', 'pyi', 'pyw'], { monarch: 'python' }),
  L('ruby', 'Ruby', ['rb', 'rake', 'gemspec', 'ru'], {
    fileNames: ['Gemfile', 'Rakefile', 'Podfile', 'Vagrantfile'],
    monarch: 'ruby',
  }),
  L('go', 'Go', ['go'], { monarch: 'go' }),
  L('rust', 'Rust', ['rs'], { monarch: 'rust' }),
  L('java', 'Java', ['java'], { monarch: 'java' }),
  L('kotlin', 'Kotlin', ['kt', 'kts'], { monarch: 'kotlin' }),
  L('scala', 'Scala', ['scala', 'sc', 'sbt'], { monarch: 'scala' }),
  L('swift', 'Swift', ['swift'], { monarch: 'swift' }),
  L('dart', 'Dart', ['dart'], { monarch: 'dart' }),
  L('groovy', 'Groovy', ['groovy', 'gradle'], { fileNames: ['Jenkinsfile'], comment: '//' }),
  L('c', 'C', ['c', 'h'], { monarch: 'cpp' }),
  L('cpp', 'C++', ['cpp', 'cc', 'cxx', 'c++', 'hpp', 'hh', 'hxx', 'h++', 'ino'], {
    monarch: 'cpp',
  }),
  L('csharp', 'C#', ['cs', 'csx'], { monarch: 'csharp' }),
  L('fsharp', 'F#', ['fs', 'fsi', 'fsx'], { monarch: 'fsharp' }),
  L('vb', 'Visual Basic', ['vb'], { monarch: 'vb' }),
  L('objective-c', 'Objective-C', ['m'], { monarch: 'objective-c' }),
  L('objective-cpp', 'Objective-C++', ['mm'], { monarch: 'objective-c' }),
  L('php', 'PHP', ['php', 'phtml'], { monarch: 'php' }),
  L('perl', 'Perl', ['pl', 'pm'], { monarch: 'perl' }),
  L('lua', 'Lua', ['lua'], { monarch: 'lua' }),
  L('r', 'R', ['r', 'rmd'], { monarch: 'r' }),
  L('julia', 'Julia', ['jl'], { monarch: 'julia' }),
  L('elixir', 'Elixir', ['ex', 'exs'], { monarch: 'elixir' }),
  L('erlang', 'Erlang', ['erl', 'hrl'], { comment: '%' }),
  L('haskell', 'Haskell', ['hs', 'lhs'], { comment: '--' }),
  L('clojure', 'Clojure', ['clj', 'cljs', 'cljc', 'edn'], { monarch: 'clojure' }),
  L('ocaml', 'OCaml', ['ml', 'mli']),
  L('elm', 'Elm', ['elm'], { comment: '--' }),
  L('gleam', 'Gleam', ['gleam'], { comment: '//' }),
  L('zig', 'Zig', ['zig', 'zon'], { comment: '//' }),
  L('nim', 'Nim', ['nim', 'nims', 'nimble'], { comment: '#' }),
  L('nix', 'Nix', ['nix'], { comment: '#' }),
  L('crystal', 'Crystal', ['cr'], { comment: '#' }),
  L('d', 'D', ['d'], { comment: '//' }),
  L('odin', 'Odin', ['odin'], { comment: '//' }),
  L('fortran-free-form', 'Fortran', ['f90', 'f95', 'f03', 'f08'], { comment: '!' }),
  L('shellscript', 'Shell', ['sh', 'bash', 'zsh', 'ksh'], {
    fileNames: ['.bashrc', '.bash_profile', '.zshrc', '.profile', '.bash_aliases'],
    monarch: 'shell',
  }),
  L('fish', 'Fish', ['fish'], { comment: '#' }),
  L('nushell', 'Nushell', ['nu'], { comment: '#' }),
  L('powershell', 'PowerShell', ['ps1', 'psm1', 'psd1'], { monarch: 'powershell' }),
  L('bat', 'Batch', ['bat', 'cmd'], { monarch: 'bat' }),
  L('sql', 'SQL', ['sql'], { monarch: 'sql' }),
  L('graphql', 'GraphQL', ['graphql', 'gql'], { monarch: 'graphql' }),
  L('proto', 'Protocol Buffers', ['proto'], { monarch: 'protobuf' }),
  L('prisma', 'Prisma', ['prisma'], { comment: '//' }),
  L('yaml', 'YAML', ['yaml', 'yml'], {
    fileNames: ['.clang-format', '.clangd'],
    monarch: 'yaml',
  }),
  L('toml', 'TOML', ['toml'], {
    fileNames: ['Cargo.lock', 'poetry.lock', 'uv.lock'],
    comment: '#',
  }),
  L('ini', 'INI', ['ini', 'cfg', 'conf', 'properties', 'editorconfig'], {
    fileNames: ['.editorconfig', '.npmrc', '.gitconfig', '.gitmodules'],
    monarch: 'ini',
  }),
  L('dotenv', 'dotenv', ['env'], { fileNames: ['.env', '.env.*'], comment: '#' }),
  L(
    'xml',
    'XML',
    [
      'xml',
      'svg',
      'xsd',
      'plist',
      'csproj',
      'fsproj',
      'vbproj',
      'props',
      'targets',
      'xaml',
      'resx',
      'nuspec',
      'wsdl',
    ],
    { monarch: 'xml' },
  ),
  L('xsl', 'XSL', ['xsl', 'xslt'], { monarch: 'xml' }),
  L('docker', 'Dockerfile', ['dockerfile', 'containerfile'], {
    fileNames: ['Dockerfile', 'Dockerfile.*', 'Containerfile', '*.Dockerfile'],
    monarch: 'dockerfile',
  }),
  L('make', 'Makefile', ['mk', 'mak'], {
    fileNames: ['Makefile', 'GNUmakefile', 'makefile'],
    comment: '#',
  }),
  L('cmake', 'CMake', ['cmake'], { fileNames: ['CMakeLists.txt'], comment: '#' }),
  L('just', 'Just', ['just'], { fileNames: ['justfile', '.justfile'], comment: '#' }),
  L('diff', 'Diff', ['diff', 'patch', 'rej']),
  L('log', 'Log', ['log']),
  L('csv', 'CSV', ['csv']),
  L('tsv', 'TSV', ['tsv']),
  L('terraform', 'Terraform', ['tf', 'tfvars'], { monarch: 'hcl' }),
  L('hcl', 'HCL', ['hcl'], { monarch: 'hcl' }),
  L('solidity', 'Solidity', ['sol'], { monarch: 'solidity' }),
  L('latex', 'LaTeX', ['tex', 'sty', 'ltx']),
  L('bibtex', 'BibTeX', ['bib']),
  L('typst', 'Typst', ['typ'], { comment: '//' }),
  L('handlebars', 'Handlebars', ['hbs', 'handlebars'], { monarch: 'handlebars' }),
  L('twig', 'Twig', ['twig'], { monarch: 'twig' }),
  L('liquid', 'Liquid', ['liquid'], { monarch: 'liquid' }),
  L('pug', 'Pug', ['pug', 'jade'], { monarch: 'pug' }),
  L('razor', 'Razor', ['cshtml', 'razor'], { monarch: 'razor' }),
  L('erb', 'ERB', ['erb']),
  L('jinja', 'Jinja', ['j2', 'jinja', 'jinja2']),
  L('glsl', 'GLSL', ['glsl', 'vert', 'frag', 'geom', 'comp'], { comment: '//' }),
  L('hlsl', 'HLSL', ['hlsl', 'fx', 'fxh'], { comment: '//' }),
  L('wgsl', 'WGSL', ['wgsl'], { monarch: 'wgsl' }),
  L('viml', 'Vim script', ['vim'], { fileNames: ['.vimrc', '_vimrc', '.gvimrc'], comment: '"' }),
  L('nginx', 'Nginx', [], { fileNames: ['nginx.conf'], comment: '#' }),
  L('ssh-config', 'SSH Config', [], { fileNames: ['ssh_config', 'sshd_config'], comment: '#' }),
  L('git-commit', 'Git Commit', [], { fileNames: ['COMMIT_EDITMSG', 'MERGE_MSG'], comment: '#' }),
  L('git-rebase', 'Git Rebase', [], { fileNames: ['git-rebase-todo'], comment: '#' }),
  L('codeowners', 'CODEOWNERS', [], { fileNames: ['CODEOWNERS'], comment: '#' }),
  L('http', 'HTTP', ['http', 'rest']),
  L('mermaid', 'Mermaid', ['mmd', 'mermaid'], { comment: '%%' }),
  L('tcl', 'Tcl', ['tcl'], { monarch: 'tcl' }),
  L('scheme', 'Scheme', ['scm', 'ss'], { monarch: 'scheme' }),
  L('racket', 'Racket', ['rkt'], { comment: ';' }),
  L('common-lisp', 'Common Lisp', ['lisp', 'lsp', 'cl'], { comment: ';' }),
  L('emacs-lisp', 'Emacs Lisp', ['el'], { comment: ';' }),
  L('purescript', 'PureScript', ['purs'], { comment: '--' }),
  L('haxe', 'Haxe', ['hx'], { comment: '//' }),
  L('coffee', 'CoffeeScript', ['coffee'], { monarch: 'coffee' }),
  L('applescript', 'AppleScript', ['applescript', 'scpt'], { comment: '--' }),
  L('verilog', 'Verilog', ['v', 'vh'], { comment: '//' }),
  L('system-verilog', 'SystemVerilog', ['sv', 'svh'], { monarch: 'systemverilog' }),
  L('vhdl', 'VHDL', ['vhd', 'vhdl'], { comment: '--' }),
  L('qml', 'QML', ['qml'], { comment: '//' }),
  L('systemd', 'systemd', ['service', 'socket', 'timer', 'mount', 'target'], { comment: '#' }),
  L('desktop', 'Desktop Entry', ['desktop'], { comment: '#' }),
  L('reg', 'Windows Registry', ['reg'], { comment: ';' }),
  L('po', 'Gettext', ['po', 'pot'], { comment: '#' }),
  L('rst', 'reStructuredText', ['rst'], { monarch: 'restructuredtext' }),
  L('asciidoc', 'AsciiDoc', ['adoc', 'asciidoc']),
  L('org', 'Org', ['org']),
  L('wasm', 'WebAssembly Text', ['wat', 'wast'], { comment: ';;' }),
  L('llvm', 'LLVM IR', ['ll'], { comment: ';' }),
  L('gdscript', 'GDScript', ['gd'], { comment: '#' }),
  L('puppet', 'Puppet', ['pp'], { comment: '#' }),
  L('bicep', 'Bicep', ['bicep'], { monarch: 'bicep' }),
  L('typespec', 'TypeSpec', ['tsp'], { monarch: 'typespec' }),
  L('cypher', 'Cypher', ['cypher', 'cyp'], { monarch: 'cypher' }),
  L('sparql', 'SPARQL', ['rq', 'sparql'], { monarch: 'sparql' }),
  L('abap', 'ABAP', ['abap'], { monarch: 'abap' }),
  L('pascal', 'Pascal', ['pas', 'dpr', 'lpr'], { monarch: 'pascal' }),
  L('apex', 'Apex', ['cls', 'trigger'], { monarch: 'apex' }),
  L('powerquery', 'Power Query', ['pq'], { monarch: 'powerquery' }),
  L('dax', 'DAX', ['dax'], { monarch: 'msdax' }),
  L('cairo', 'Cairo', ['cairo'], { comment: '//' }),
  L('kdl', 'KDL', ['kdl'], { comment: '//' }),
  L('ron', 'RON', ['ron'], { comment: '//' }),
  L('wit', 'WIT', ['wit'], { comment: '//' }),
  L('mojo', 'Mojo', ['mojo'], { comment: '#' }),
  L('vala', 'Vala', ['vala', 'vapi'], { comment: '//' }),
  L('ballerina', 'Ballerina', ['bal'], { comment: '//' }),
  L('matlab', 'MATLAB', [], { comment: '%' }),
] as const satisfies readonly CodeLanguage[];

/** No coloring at all: what the user picks when the guess is wrong and nothing fits. */
export const PLAIN_TEXT = 'plaintext';

export const ASSOCIATIONS_LIMIT = 100;
const ASSOCIATION_PATTERN_LIMIT = 200;

const byId = new Map<string, CodeLanguage>(CODE_LANGUAGES.map((l) => [l.id, l]));
const byExtension = new Map<string, CodeLanguage>();
const byFileName = new Map<string, CodeLanguage>();
const byFilePrefix: [string, CodeLanguage][] = [];
const byFileSuffix: [string, CodeLanguage][] = [];
for (const language of CODE_LANGUAGES as readonly CodeLanguage[]) {
  for (const extension of language.extensions ?? []) {
    if (!byExtension.has(extension)) byExtension.set(extension, language);
  }
  for (const name of language.fileNames ?? []) {
    const lower = name.toLowerCase();
    if (lower.endsWith('*')) byFilePrefix.push([lower.slice(0, -1), language]);
    else if (lower.startsWith('*')) byFileSuffix.push([lower.slice(1), language]);
    else byFileName.set(lower, language);
  }
}

export const codeLanguage = (id: string): CodeLanguage | undefined => byId.get(id);

export const isCodeLanguageId = (id: unknown): id is string =>
  typeof id === 'string' && (id === PLAIN_TEXT || byId.has(id));

/** `*` is any run of characters but a separator, `**` any run at all, `?` one character. */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i');
}

/**
 * The language of a file. The user's associations come first (a pattern with a `/` is matched
 * against the whole path, one without against the name), then the name, then the extension.
 * Null when nothing is known: the editor then guesses by itself, as it always did.
 */
export function resolveCodeLanguage(
  file: string,
  associations: Readonly<Record<string, string>> = {},
): string | null {
  const filePath = file.replace(/\\/g, '/');
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  for (const [pattern, id] of Object.entries(associations)) {
    if (!isCodeLanguageId(id)) continue;
    if (globToRegExp(pattern).test(pattern.includes('/') ? filePath : name)) return id;
  }
  const lower = name.toLowerCase();
  const exact = byFileName.get(lower);
  if (exact) return exact.id;
  for (const [prefix, language] of byFilePrefix) if (lower.startsWith(prefix)) return language.id;
  for (const [suffix, language] of byFileSuffix) if (lower.endsWith(suffix)) return language.id;
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  return byExtension.get(lower.slice(dot + 1))?.id ?? null;
}

/** Associations as the preferences keep them: known languages, short patterns, a limit. */
export function sanitizeAssociations(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [pattern, id] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(result).length >= ASSOCIATIONS_LIMIT) break;
    const key = pattern.trim();
    const control = [...key].some((c) => c.charCodeAt(0) < 32);
    if (!key || key.length > ASSOCIATION_PATTERN_LIMIT || control) continue;
    if (isCodeLanguageId(id)) result[key] = id;
  }
  return result;
}

/** `*.mdc = markdown`, one per line, as the preferences show them. */
export const formatAssociations = (associations: Readonly<Record<string, string>>): string =>
  Object.entries(associations)
    .map(([pattern, id]) => `${pattern} = ${id}`)
    .join('\n');

/** Reads the text of `formatAssociations`. Lines it cannot read are returned apart. */
export function parseAssociations(text: string): {
  associations: Record<string, string>;
  invalid: string[];
} {
  const associations: Record<string, string> = {};
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.lastIndexOf('=');
    const pattern = at > 0 ? line.slice(0, at).trim() : '';
    const id =
      at > 0
        ? line
            .slice(at + 1)
            .trim()
            .toLowerCase()
        : '';
    if (pattern && isCodeLanguageId(id)) associations[pattern] = id;
    else invalid.push(line);
  }
  return { associations: sanitizeAssociations(associations), invalid };
}
