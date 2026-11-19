import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'demo/index.html' : pathname.replace(/^\/+/, '');
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Coloring Mode demo: http://127.0.0.1:${port}\n`);
});
