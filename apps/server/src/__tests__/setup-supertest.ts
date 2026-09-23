import type { Server } from 'node:http';
import supertest from 'supertest';

// Supertest binds unstarted fixtures to :: but hardcodes requests to
// 127.0.0.1. On macOS that IPv4 port can belong to a different application.
// Keep requests in the family actually owned by the fixture. This only
// changes test transport; application authentication/headers are untouched.
const serverAddress = supertest.Test.prototype.serverAddress;
supertest.Test.prototype.serverAddress = function (app, path) {
  const url = serverAddress.call(this, app, path);
  const address = (app as Server).address?.();
  return address && typeof address !== 'string' && address.family === 'IPv6'
    ? url.replace('://127.0.0.1:', '://[::1]:')
    : url;
};
