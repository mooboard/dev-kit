# v3 validation record

Date: 2026-10-28. Status: software candidate, unreleased.

## Verified

- 6,284 native C++ cases pass across 124 suites, including full firmware and alpha1, alpha2 and gaming profile checks. One case is skipped.
- 245 Python tests pass, including firmware-reader parity, codecs, builder, documentation, native preview behavior, portal assets and composer parity.
- 96 store-builder tests pass.
- All 37 native presets and five generic custom starters build repeatably with stock Python 3.9.
- SDK and store builders produce identical custom-package bytes, including the default icon.
- API template substitutions match the compiled firmware for toggle, text, color and choice settings and local credential placeholders. Validation caught and corrected preview toggle values using Python capitalization instead of JSON spelling.
- Node checks of the shipped picker polling functions pass for background/resume, view changes and overlapping redraws.
- Native-library stress cases reject oversized sorts, concatenations and UTF-8 scans before they stall a frame. Ordinary helper behavior is covered by regression tests.
- Generic clock, ambiance, data, game and tool frames were rendered and visually inspected.
- ESP32-S3 firmware, simulator and portal mock compile successfully.
- The exported kit passes public and private content scans. Dependency licenses are included.

Runtime tests cover executable custom logic, settings, multiple input events, pause and resume, controller disconnects, durable state, local credentials, API refresh and retry, offline data, malformed packages, instruction limits, drawing limits, native-library work limits and memory limits. Portal tests exercise upload, installation completion, picker selection, RGB previews, setting changes, lock, temporary mode ownership and removal.

The native host runs each of the five generic starters for 120 frames and records Lua heap and frame timing. Native frame timings are computer measurements and do not establish board performance.

## Required before release

Browser and test-board validation is authorized. The execution environment refused local network listeners, board HTTP connections and USB serial writes, and could not launch the browser. The interactive browser workflow remains unverified. Hardware validation has not been performed.

Complete these checks with compatible firmware on a test board:

1. Create, edit, preview, install and remove a custom app through the documented commands.
2. Select custom clocks and ambiances in their pickers. Verify live tiles and setting changes in the browser and on the display.
3. Verify regular-app controls, lock and rotation, temporary modes, pause and resume, and controller disconnects.
4. Connect a real HTTPS feed with local credentials. Verify refresh, failure, recovery and offline behavior.
5. Restart the board and verify settings, selection and checkpointed state. Check display frame timing, heap and task-stack margins under load.
6. Confirm existing picture apps, native apps and the composer still work in the browser and on the board.

Release requires these checks and owner approval. No publication or device installation is implied by this validation record.
