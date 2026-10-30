// Third-party views that take Uniwind classes (MD-133): Uniwind maps className only on React Native's own components
// (and Reanimated's, through its Metro resolver); anything else needs withUniwind so `className` /
// `contentContainerClassName` become `style` / `contentContainerStyle`.
import {
  KeyboardAvoidingView as KCKeyboardAvoidingView,
  KeyboardAwareScrollView as KCKeyboardAwareScrollView,
  KeyboardStickyView as KCKeyboardStickyView,
} from 'react-native-keyboard-controller';
import { LegendList as LegendListBase } from '@legendapp/list/react-native';
import { GestureHandlerRootView as RNGHRootView } from 'react-native-gesture-handler';
import { withUniwind } from 'uniwind';

export const KeyboardAvoidingView = withUniwind(KCKeyboardAvoidingView);
export const KeyboardAwareScrollView = withUniwind(KCKeyboardAwareScrollView);
export const KeyboardStickyView = withUniwind(KCKeyboardStickyView);
/** The app root's gesture host (app/_layout.tsx). */
export const GestureHandlerRootView = withUniwind(RNGHRootView);

/**
 * Legend List with `className` / `contentContainerClassName` (Uniwind's automatic mode maps every `*Style` prop).
 * Cast back to the generic component so `data` / `renderItem` keep their item type.
 */
export const LegendList = withUniwind(LegendListBase) as unknown as typeof LegendListBase;
