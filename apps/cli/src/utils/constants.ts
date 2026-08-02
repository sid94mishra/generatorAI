/** Delay in ms before exiting the Ink render loop */
export const EXIT_DELAY_MS = 200;

/** CLI version */
export const CLI_VERSION = '0.1.0';

/** Default server URL */
export const DEFAULT_SERVER_URL = 'http://localhost:3100';

/** Exit codes */
export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  TIMEOUT: 2,
  CANCELLED: 3,
  NOT_FOUND: 4,
  AUTH_FAILURE: 5,
  CANNOT_EXECUTE: 126,
  COMMAND_NOT_FOUND: 127,
} as const;
