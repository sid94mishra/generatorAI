const path = require('node:path');
const workletsResolver = require('react-native-worklets/jest/resolver');

// Match Metro's workspace source entry points, retaining Worklets' supported
// Jest fallback instead of loading its native JSI runtime inside Node.
module.exports = (request, options) => {
  const workspace = request.startsWith('@generatorai/');
  const resolveOptions = workspace ? { ...options, conditions: ['import', 'react-native', 'default'] } : options;
  const target = request === '@generatorai/shared'
    ? path.resolve(__dirname, '../../../packages/shared/src/client.ts')
    : request.startsWith('@/') ? path.resolve(__dirname, '../src', request.slice(2)) : request;
  try {
    return workletsResolver(target, resolveOptions);
  } catch (error) {
    // NodeNext .js specifiers in shared TS source; keep real .js files first.
    if (target.startsWith('.') && target.endsWith('.js')) return workletsResolver(target.slice(0, -3), resolveOptions);
    throw error;
  }
};
