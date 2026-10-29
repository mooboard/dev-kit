# mooboard dev-kit v3

Make screens and apps for mooboard, a 128×32 matrix LED display.

Create your own drawing and app logic, connect JSON APIs, declare settings and controls, and test the same runtime locally and on a board. Picture/GIF apps and the drag-and-drop composer are included too.

## Start

Requires git, Python 3.9 or newer, a browser, and a C/C++ compiler for live apps. On macOS, install Apple's command-line tools with `xcode-select --install`.

```sh
git clone https://github.com/mooboard/dev-kit.git
cd dev-kit
open previewer/index.html
open composer/index.html
python3 -m mooboard play samples/hello
```

In samples/hello/app.py, change `Hello` to your desired text. Run `python3 -m mooboard play samples/hello` again to view your app folder.

For your own live app:

```sh
python3 -m mooboard new "My App" --author YOUR-GITHUB-NAME
python3 -m mooboard play "My App"
```

Edit `My App/app.lua`. The preview reloads code changes and lets you change settings and send controls.

## Choose a starting point

Add `--template data`, `clock`, `ambiance`, `game`, or `tool` to `new`. These are generic examples you can replace with your own code.

Categories follow the store: Lifestyle, Ambiance, Clock Faces, Games, Tools, and AI. Clock apps join Clock's picker. Ambiance apps join Ambiance with previews and settings. Other apps support settings, controls, rotation and locking.

## Test on your board

Enable Developer mode in Settings. Use firmware with the v3 runtime (0.4.1 or later).

```sh
python3 -m mooboard install "My App" --board mooboard.local
```

Use your board's local name or address. Installation never updates firmware automatically.

## Learn more

- [Live apps and runtime](docs/LIVE_APPS.md)
- [Your own API and credentials](docs/API_DATA.md)
- [Categories and submission rules](RULES.md)
- [Validation and release status](docs/V3_READINESS.md)

For picture/GIF apps, run `python3 -m mooboard play samples/hello`, or open `composer/index.html` and `previewer/index.html`.

Discuss an app in the [apps forum](https://discord.com/channels/1559692577538707508/1559708612031680533), then file an [app proposal](https://github.com/mooboard/dev-kit/issues/new?template=app-proposal.yml). Help is on [Discord](https://mooboard.co/discord).

The [previewer](https://mooboard.github.io/dev-kit/previewer/) and the [composer](https://mooboard.github.io/dev-kit/composer/) are also websites.
