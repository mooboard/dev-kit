# v3 validation and release status

This v3 release candidate has passed software, browser and ESP32-S3 board validation. It is not published. Physical panel appearance and P4 hardware are not verified.

The kit and compatible firmware must pass these checks together:

- Categories exactly match the store export, including original preset categories.
- A developer writes new app logic, builds it and previews that same code locally.
- Clock and Ambiance apps install into their pickers with working previews and settings.
- Regular apps expose settings, controls, rotation, locking and open/close behavior.
- API feeds update asynchronously and preserve useful last-good data when a request fails.
- Credentials remain outside packages and app code.
- State survives display turns and restart. Disconnect releases held controls.
- Source edit, build, preview, install, operation, restart and removal pass on a board.
- Existing picture/GIF apps and the composer keep working.
- Runtime, package, integration, browser and firmware checks pass, followed by final review.

See [the validation record](VALIDATION.md) for measured results and remaining checks. Building a package alone is not proof of board behavior.
