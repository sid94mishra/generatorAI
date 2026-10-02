import 'react-native-gesture-handler/jestSetup';
import { setUpTests } from 'react-native-reanimated';

setUpTests();
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
// MMKV v4 uses its own in-memory implementation when JEST_WORKER_ID is set.
// Uniwind (resolved by Metro, absent in Jest): tests assert semantics and callbacks, not computed CSS.
