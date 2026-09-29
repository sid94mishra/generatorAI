# M1-08 — Uniwind gates

Status: **Gate A closed; Gate B pending**, 2026-09-29 (MD-107). No styling-engine migration is claimed.

Task packet: MD-10, 02 §9.9 (all twelve Gate B checks). Registry checks today:

| Package | Published tag |
|---|---|
| expo latest / sdk-57 | 57.0.26 |
| expo next | 58.0.0-preview.8 |
| expo canary | 58.0.0-canary-20260909-ea7a89a |
| uniwind latest | 1.12.0 |
| nativewind latest | 4.2.7 |
| nativewind preview / rc | 5.0.0-rc.0 |

[PR 686](https://github.com/uni-stack/uniwind/pull/686) is merged, but Gate A explicitly requires a published version after 1.12.0. A merged fix alone does not satisfy that condition. Keep platform class variants prohibited. SDK 58 stable is not published; the plan's stable-upgrade gate remains open. NativeWind 5 is still RC, so the specified stable fallback condition is also unmet.

All twelve Gate B checks remain **not run**: boot, themes, platform geometry, accent mutation, ScopedTheme, vocabulary/text metrics, native shadows/fonts, color props/insets, cross-platform release leakage, Activity reactivation, Reanimated wrapper, package CSS import. The scratch SDK 58 preview build is deferred while MV-07 rebuilds are active on the memory-limited host; resume before M3 adopts an engine. Independent M1-09 and M2 work can proceed. Tracked as MV-09.

Sources: npm registry metadata (`pnpm view <package> dist-tags/version`), [Uniwind releases](https://github.com/uni-stack/uniwind/releases), linked upstream PR. These checks do not substitute for the native Gate B evidence.
