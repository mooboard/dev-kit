# v3 validation record

Date: 2026-10-29. Version: devkit v3.0.0. Validated on ESP32-S3.

## Software and browser checks

- Full native baseline: 6,284 cases passed across 124 suites, with one skipped case. All affected suites passed again after runtime, portal, feed and TLS fixes. These later runs include 797 runtime/portal/apps/art cases, 747 API cases, 33 release-profile cases and 32 TLS-routing cases. The runs overlap.
- The prior 245 Python checks passed. Final focused SDK runtime checks (13) and stack-tool checks (26, one skipped) passed. Store-builder checks (96) passed.
- All 37 native presets and five generic custom starters build repeatably with stock Python 3.9. The README workflow passes. SDK and store custom-package bytes match.
- 28 desktop and phone browser checks pass with the actual native preview server and C++ portal API. Multiple clock and ambiance previews finish loading. The composer exports a picture package that the previewer imports.
- Full, alpha1 and alpha2 ESP32-S3 firmware, simulator and portal mock builds pass.
- The exported kit passes layout, public-content and private-content checks. Dependency licenses are included.

## ESP32-S3 board checks

The compatible firmware and generic validation apps were installed on an identified ESP32-S3 test board with 16 MB flash and 8 MB PSRAM.

Verified installation completion, clock and ambiance selection, live RGB previews and typed settings. Buttons, steppers, readouts, lists, lock and restored rotation passed. Temporary display ownership, interruption and resume, controller input expiry, board time preferences, and checkpointed state, settings, selections and locking after restart passed.

A real HTTPS service received a synthetic local credential header. Success, failed requests with retained last-good data, settings substitutions and recovery passed. Credentials stayed out of packages and settings responses. Offline feed behavior is covered by native tests. The board's Wi-Fi was not deliberately disconnected.

Deep callback stress rendered successfully, a callback beyond the stack limit was refused, and the board recovered. A composer picture package rendered through the normal rotation. Validation apps were removed through the board API.

Device testing corrected empty-list handling, last-good feed retention after setting changes, and internal-memory pressure during HTTPS activity. TLS allocations use available external RAM while retaining certificate verification. UART logs and status records include heap, frame timings and task-stack margins. Frame timings include startup and I/O transients. The runtime does not promise a hard frame deadline.

## Hardware limits

The test board has no attached panel. Framebuffer rendering is verified. Physical LED appearance is not. This firmware checkout has no P4 build target, so P4 compilation and device behavior remain unverified. These limits apply to the tested hardware scope.
