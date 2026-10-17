import { describe, expect, it } from 'vitest';
import { findLocations, findUrls } from '../../src/shared/locations';

const paths = (line: string) =>
  findLocations(line).map((m) => ({
    text: line.slice(m.start, m.end),
    path: m.path,
    line: m.line,
    column: m.column,
  }));

describe('findLocations: output of real tools', () => {
  it('tsc, with the position in parentheses', () => {
    const line = "src/core/git/GitService.ts(241,7): error TS2345: Argument of type 'x' is wrong.";
    expect(paths(line)).toEqual([
      {
        text: 'src/core/git/GitService.ts(241,7)',
        path: 'src/core/git/GitService.ts',
        line: 241,
        column: 7,
      },
    ]);
  });

  it('a tsc position with only the line', () => {
    expect(paths('tests/x.test.ts(12): error')[0]).toMatchObject({
      path: 'tests/x.test.ts',
      line: 12,
    });
  });

  it('eslint prints the file alone, and the positions on their own lines', () => {
    expect(paths('/home/me/proj/src/app.ts')).toMatchObject([{ path: '/home/me/proj/src/app.ts' }]);
  });

  it('vitest', () => {
    expect(paths(' ❯ tests/core/locations.test.ts:12:5')).toMatchObject([
      { path: 'tests/core/locations.test.ts', line: 12, column: 5 },
    ]);
    expect(paths(' FAIL  tests/core/locations.test.ts > findLocations > tsc')).toMatchObject([
      { path: 'tests/core/locations.test.ts' },
    ]);
  });

  it('pytest and Python tracebacks', () => {
    expect(paths('tests/test_app.py:42: AssertionError')).toMatchObject([
      { path: 'tests/test_app.py', line: 42 },
    ]);
    const traceback = '  File "/work/app/main.py", line 17, in run';
    const [match] = findLocations(traceback);
    expect(match).toMatchObject({ path: '/work/app/main.py', line: 17 });
    expect(traceback.slice(match!.start, match!.end)).toBe('/work/app/main.py", line 17');
  });

  it('cargo and go', () => {
    expect(paths('  --> src/main.rs:4:5')).toMatchObject([
      { path: 'src/main.rs', line: 4, column: 5 },
    ]);
    expect(paths('./main.go:12:3: undefined: foo')).toMatchObject([
      { path: './main.go', line: 12, column: 3 },
    ]);
    expect(paths('../pkg/util/util.go:9: x')).toMatchObject([
      { path: '../pkg/util/util.go', line: 9 },
    ]);
  });

  it('gcc style and a path alone', () => {
    expect(paths('main.c:10:2: warning: x')).toMatchObject([
      { path: 'main.c', line: 10, column: 2 },
    ]);
    expect(paths('see README.md for details')).toMatchObject([{ path: 'README.md' }]);
  });
});

describe('findLocations: Windows and Linux spellings', () => {
  it('reads drive letters, backslashes and the MSYS form', () => {
    expect(paths('C:\\x\\y.ts:3')).toMatchObject([{ path: 'C:\\x\\y.ts', line: 3 }]);
    expect(paths('c:/x/y.ts:3:9')).toMatchObject([{ path: 'c:/x/y.ts', line: 3, column: 9 }]);
    expect(paths('/c/x/y.ts:3')).toMatchObject([{ path: '/c/x/y.ts', line: 3 }]);
    expect(paths('x\\y.ts')).toMatchObject([{ path: 'x\\y.ts' }]);
    expect(paths('error in .\\src\\a.ts(4,1)')).toMatchObject([
      { path: '.\\src\\a.ts', line: 4, column: 1 },
    ]);
  });

  it('keeps accents and spaces out of the way', () => {
    expect(paths('src/ação/olá.ts:2')).toMatchObject([{ path: 'src/ação/olá.ts', line: 2 }]);
  });
});

describe('findLocations: what is not a path', () => {
  it('ignores plain words, numbers and versions', () => {
    expect(paths('error: something failed in 3.5 seconds, v2.0.1 e.g. now')).toEqual([]);
  });

  it('leaves the full stop of a sentence out of the name', () => {
    expect(paths('Edited src/a.ts.')).toMatchObject([{ path: 'src/a.ts' }]);
    const [match] = findLocations('Edited src/a.ts:3.');
    expect(match).toMatchObject({ path: 'src/a.ts', line: 3 });
  });

  it('does not take pieces of an address', () => {
    expect(paths('open https://example.com/docs/index.html:80 now')).toEqual([]);
  });

  it('does not scan huge lines', () => {
    expect(findLocations(`src/a.ts:1 ${'x'.repeat(3000)}`)).toEqual([]);
  });

  it('reports positions that slice back to the text', () => {
    const line = 'a  src/a.ts:1:2  and  b/c.ts(3,4)';
    expect(findLocations(line).map((m) => line.slice(m.start, m.end))).toEqual([
      'src/a.ts:1:2',
      'b/c.ts(3,4)',
    ]);
  });
});

describe('findUrls', () => {
  it('finds http and https and trims the end of the sentence', () => {
    const line = 'Local: http://localhost:3000/app, docs (https://a.dev/x_(y)).';
    expect(findUrls(line).map((u) => u.url)).toEqual([
      'http://localhost:3000/app',
      'https://a.dev/x_(y)',
    ]);
  });

  it('opens localhost:3000 as http', () => {
    const line = 'listening on localhost:3000';
    const [url] = findUrls(line);
    expect(url).toMatchObject({ url: 'http://localhost:3000' });
    expect(line.slice(url!.start, url!.end)).toBe('localhost:3000');
    expect(findUrls('on 127.0.0.1:8080/x')[0]?.url).toBe('http://127.0.0.1:8080/x');
  });

  it('does not duplicate the address of the local form inside a full one', () => {
    expect(findUrls('http://localhost:3000')).toHaveLength(1);
  });
});
