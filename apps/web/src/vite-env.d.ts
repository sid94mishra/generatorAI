/// <reference types="vite/client" />

/**
 * App version, replaced at build time by Vite's `define` from the root
 * package.json. Declared here so TypeScript sees it as a real global rather
 * than an undefined identifier.
 */
declare const __APP_VERSION__: string;
