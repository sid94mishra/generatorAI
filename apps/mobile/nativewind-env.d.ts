/// <reference types="nativewind/types" />

// NativeWind augments React Native's component props with `className` via
// declaration merging. This file is the documented way to pull those types
// in; without it every styled element is a type error.
//
// It must NOT be named `nativewind.d.ts` (or match a folder in node_modules),
// or TypeScript silently ignores it.
