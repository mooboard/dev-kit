# v3 compatibility and validation

Devkit v3.0.0 is ready to create, build and preview apps in Lifestyle, Ambiance, Clock Faces, Games, Tools and AI. Local authoring needs no board.

Custom Lua app installation requires firmware with the v3 runtime and Developer mode enabled. The installer checks the board's runtime capability. Existing firmware without that capability needs a compatible firmware update before it can run format 3 apps. Installing an app does not update firmware.

Clock Faces and Ambiance apps appear in their pickers with live previews and settings. Other apps support settings, controls, rotation, locking and temporary display ownership. Picture/GIF apps and native renderer presets remain supported.

Software, desktop/phone browser and ESP32-S3 board workflows passed validation. The test board had no attached panel, so physical LED appearance was not inspected. P4 compilation and device behavior remain unverified. See [the validation record](VALIDATION.md) for the tested scope.
