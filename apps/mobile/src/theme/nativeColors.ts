// The literal theme colours for services that paint outside React Native (02 §2.6): system surfaces (widgets, Live
// Activities, Live Updates). Services may not import the kit (`ui/`), so the theme layer hands them the store.
export { getThemeColors, subscribeThemeColors, type ThemeColors } from '../ui/lib/themeColors';
