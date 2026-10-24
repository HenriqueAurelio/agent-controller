// Shows exactly what reaches a program from the terminal, as an agent with bracketed paste on
// would receive it. Each chunk is printed escaped; `q` ends it.
'use strict';

process.stdout.write('\x1b[?2004h');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdout.write('pronto para receber\r\n');
process.stdin.on('data', (chunk) => {
  if (chunk === 'q') {
    process.stdout.write('\x1b[?2004l');
    process.exit(0);
  }
  process.stdout.write(`recebido: ${JSON.stringify(chunk)}\r\n`);
});
