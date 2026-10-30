# M1-07 — markdown adoption gate

Status: **pending native benchmark**, 2026-09-29 (MD-107). No performance pass or renderer adoption is claimed.

Task packet: MD-40; compare the current marked → RN renderer against react-native-enriched-markdown fed per block from markdownModel. Acceptance requires streaming 2,000 lines at 60 fps on the Android test device, plus selection/copy on both platforms.

Registry check reports react-native-enriched-markdown 1.0.2. [Upstream streaming documentation](https://github.com/software-mansion/react-native-enriched-markdown/blob/main/docs/MARKDOWN_STREAMING.md) also describes its optional streamdown processor; that is background information, not authorization to replace the specified per-block spike.

| Measurement | Result |
|---|---|
| Native 2,000-line frame rate | not measured |
| iOS selection/copy | not tested |
| Android selection/copy | not tested |

The native Storybook/test build is still being established (MV-07), so defer this gate to the completed native harness rather than blocking independent service/shared-logic work. Keep the current renderer until MD-40's positive adoption evidence exists; this is a conservative interim state, not a completed go/fallback spike. Next: run the prescribed native comparison before M6-02 markdown implementation; record device, build mode, trace, fps and selection/copy evidence here. Tracked as MV-08.
