# scrcpy-server

`scrcpy-server-v3.3.3` is the server half of [scrcpy](https://github.com/Genymobile/scrcpy) 3.3.3, unmodified, from
the project's GitHub release:

- URL: https://github.com/Genymobile/scrcpy/releases/download/v3.3.3/scrcpy-server-v3.3.3
- sha256: `7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0` (matches the release asset digest)
- Licence: Apache License 2.0, Copyright (C) 2018 Genymobile, Copyright (C) 2018-2026 Romain Vimont

The Devices tab pushes it to an Android device to stream the screen and send input (docs/devices DV-2). The version is
pinned to the one `@yume-chan/adb-scrcpy` 2.3.x speaks (`AdbScrcpyOptionsLatest` = 3.3.3); upgrade both together.
