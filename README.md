# mooboard dev-kit v3.0.0

Make screens and apps for mooboard, a 128×32 matrix LED display.

Build apps with your own Lua drawing and logic, settings, controls and JSON APIs. The kit also includes picture/GIF apps, a drag-and-drop composer and a previewer.

## Start

Requires git, Python 3.9 or newer, a browser, and a C/C++ compiler for live apps. On macOS, install Apple's command-line tools with `xcode-select --install`. On Linux, install a C/C++ toolchain. Local builds and previews work without a board.

```sh
git clone https://github.com/mooboard/dev-kit.git
cd dev-kit
open previewer/index.html
open composer/index.html
python3 -m mooboard play samples/hello
```

On Linux, open the two HTML files in your browser. In samples/hello/app.py, change `Hello` to your desired text. Run `python3 -m mooboard play samples/hello` again to see the change.

## Create a live app

For your own live app:

```sh
python3 -m mooboard new "My App" --template tool --category Tools --author YOUR-GITHUB-NAME
python3 -m mooboard build "My App"
python3 -m mooboard play "My App"
```

Edit `My App/app.lua` to implement your app. Declare settings, controls and data sources in `My App/mooboard.json`. The local preview reloads code changes and provides settings and controls. Stop it with Ctrl+C before rebuilding.

## Choose a category

Categories match the app store. Every custom app declares one.

| Category | Where it appears | App behavior |
| --- | --- | --- |
| Lifestyle | App screen | Information, routines and everyday apps with settings, rotation and locking. |
| Ambiance | Ambiance picker | Continuous visuals with live previews and their own settings. |
| Clock Faces | Clock picker | Clock faces with live previews, face settings and board time preferences. |
| Games | App screen + controller | Your game logic, autonomous play and touch, keyboard or gamepad controls. |
| Tools | App screen | Stateful utilities with settings, controls, rotation and locking. |
| AI | App screen | Your AI behavior or API connection, with settings and useful loading/error states. |

Use `--template clock`, `ambiance`, `data`, `game` or `tool` as a starting point. Clock and ambiance templates choose their matching categories automatically. Other templates default to Tools or Games. Use `--category` to choose any category above.

```sh
python3 -m mooboard new "My Clock" --template clock --author YOUR-GITHUB-NAME
python3 -m mooboard new "My Visual" --template ambiance --author YOUR-GITHUB-NAME
python3 -m mooboard new "My Data" --template data --category Lifestyle --author YOUR-GITHUB-NAME
```

The app supplies its behavior. A category determines where the board presents it.

## Connect your API

Declare HTTPS JSON feeds and draw the returned data in Lua. You can use an existing service or write and host your own API. Keep credentials in local preview environment variables or the board's local credential storage. See [API data and credentials](docs/API_DATA.md).

## Test on a board

Enable Developer mode in the board's Settings. Custom Lua apps need compatible firmware with the v3 runtime. The installer checks support before uploading. A firmware version number alone does not establish compatibility. See [compatibility and validation](docs/V3_READINESS.md).

```sh
python3 -m mooboard install "My App" --board mooboard.local
```

Use the board's local name or address. Add `--password` if the portal requires a password. Firmware updates are a separate step.

## Learn more

- [Live app code, settings, controls and lifecycle](docs/LIVE_APPS.md)
- [Your own API and credentials](docs/API_DATA.md)
- [Categories and submission rules](RULES.md)
- [Validation record and hardware limits](docs/VALIDATION.md)

For picture/GIF apps, run `python3 -m mooboard play samples/hello`, or open the composer and previewer. Native renderer presets are available through `python3 -m mooboard renderers` and `new --uses RENDERER`. Submit those through the store.

`samples/clock`: The time and date come from when the app is built. GitHub builds it in UTC. `samples/face`: A GIF snapshot example. Use the custom clock template for a live face in Clock with settings.

Discuss an app in the [apps forum](https://discord.com/channels/1559692577538707508/1559708612031680533), then file an [app proposal](https://github.com/mooboard/dev-kit/issues/new?template=app-proposal.yml). Help is on [Discord](https://mooboard.co/discord).

The [previewer](https://mooboard.github.io/dev-kit/previewer/) and the [composer](https://mooboard.github.io/dev-kit/composer/) are also websites.
