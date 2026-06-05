import 'dotenv/config';

if (String(process.env.LOG_CONSOLE ?? 'true').toLowerCase() === 'false') {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
}

await import('./index.js');
