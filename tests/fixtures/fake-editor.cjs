// A stand-in for an external editor: appends the arguments it received, as one JSON line, to the
// file named by its first argument.
const fs = require('node:fs');

fs.appendFileSync(process.argv[2], `${JSON.stringify(process.argv.slice(3))}\n`);
