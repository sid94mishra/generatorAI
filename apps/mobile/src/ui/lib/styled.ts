// Third-party views that take Uniwind classes (MD-133): Uniwind maps className only on React Native's own components
// (and Reanimated's, through its Metro resolver); anything else needs withUniwind so `className` /
// `contentContainerClassName` become `style` / `contentContainerStyle`.
import {
  KeyboardAvoidingView as KCKeyboardAvoidingView,
  KeyboardAwareScrollView as KCKeyboardAwareScrollView,
  KeyboardStickyView as KCKeyboardStickyView,
} from 'react-native-keyboard-controller';
import { withUniwind } from 'uniwind';

export const KeyboardAvoidingView = withUniwind(KCKeyboardAvoidingView);
export const KeyboardAwareScrollView = withUniwind(KCKeyboardAwareScrollView);
export const KeyboardStickyView = withUniwind(KCKeyboardStickyView);
