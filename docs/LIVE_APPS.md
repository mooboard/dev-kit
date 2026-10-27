# Build a live app

The v3 draft can build packages for the same 37 catalog renderers used by the prototype. A renderer runs on the board. Its package supplies the name, icon, defaults, settings, controls, and supported data. Python runs on your computer to make GIFs or build packages. Python code is not installed on the board.

## Start from a real app

Run these from the dev kit folder. Python 3.9 or newer is enough. No extra packages are needed.

```sh
python3 -m mooboard renderers
python3 -m mooboard new "My Racer" --uses microracer --author YOUR-GITHUB-NAME
python3 -m mooboard build "My Racer"
```

The result is `My Racer/build/my-racer-1.0.0.mooboard`, with a release description beside it. Building the same inputs again produces the same package bytes. The included `samples/live/` folders can also be built directly. The builder ignores its own `build/` output on subsequent builds.

Other starting points:

```sh
python3 -m mooboard new "My Aquarium" --uses aquarium --author YOUR-GITHUB-NAME
python3 -m mooboard new "My Timer" --uses timer --author YOUR-GITHUB-NAME
python3 -m mooboard new "My Facts" --uses facts --author YOUR-GITHUB-NAME
```

## Choose what actually runs

| Category | Renderers |
| --- | --- |
| Games | pong, snake, blocks, maze, breakout, invaders, flappy, cycles, microracer, pixelpinball, microrogue, spacelander |
| Ambiance | aquarium, lava, aurora, rain, fireworks, nightcity, snowglobe, raincode, vfdstereo |
| Clock Faces | Installation support pending. No app renderer currently installs a new face. |
| Tools | habits, timer, pomodoro, scoreboard, dice, chores, intervals, chessclock, wheel, tally |
| Misc | sunmoon, word, quotes, oktowake, facts, jokes |

The manifest uses `ClockFaces` as the proposed single-word category key, with Clock Faces as its display name. The other keys are the names shown above. Category routing is under development. Changing an app's category does not give it new behavior, and this draft refuses incompatible category and renderer combinations.

Pong shows a clock during its game simulation. Sun and Moon uses the time and location. Neither package adds a selectable clock face. The draft deliberately refuses clock face packages until installation into Clock works.

## Edit the package

Edit `mooboard.json` and `icon.png`. Your name is at most 24 characters, description at most 80, icon exactly 32×32 PNG and at most 8 KB. Give the app your own ID and GitHub name. `format: 2` is the existing live package format. Dev kit v3 does not imply a package format 3.

Settings and controls must use the keys and types declared by the chosen renderer. The starter includes its real supported controls. Choice option order has meaning in the renderer. Renaming Normal to Turbo changes the label, not the speed. Keep the number and meaning of choices. New keys, arbitrary game rules, new layouts, and additional network calls need a new firmware renderer.

Word, Quotes, Facts, and Jokes carry `data/list.json`. Edit that list to supply original content. Keep the included item shape. The builder validates lengths and removes the source and attribution fields that the renderer does not display. Other catalog renderers have no package data directory. Timer buttons can carry a supported `arg`, for example a start preset in seconds.

An app's `minFirmware` is at least 0.3.1. Micro Racer, Pixel Pinball, Tiny Dungeon Crawler, Asteroid Lander, and HiFi VFD Spectrum need at least 0.3.2 in this kit. Game-pad and microphone availability also depend on the installed board profile and browser. A package cannot enable a missing firmware feature.

## Test and install

`python3 -m mooboard build APP` checks and writes the live package. The build also writes `build/mooboard.json` with the renderer, firmware minimum, target boards, byte count, and SHA-256 digest. This file is an unsigned catalog row for inspection, not an install authorization.

The browser GIF player, composer, and picture previewer support artwork and GIF apps. They do not execute live renderers. `play` reports that limitation for a live app instead of showing a substitute animation. Test controls, state, pad input, and reactive audio on compatible firmware after installation through the store. A local package passing validation does not show that its runtime behavior has been tested.

Today, Add from file and developer repositories accept format 1 GIF apps. Format 2 live packages are installed through the signed store catalog. To submit, use a folder named after your app under its category in the apps repository, with `mooboard.json`, `icon.png`, optional `data/`, a README, and an appropriate license. Do not copy `build/`. The v3 category migration must land in the store before its new categories can be submitted there. Store review and signing happen after acceptance.

## Build something new

A new renderer requires firmware work today. The downloadable package cannot carry executable code. This draft gives you presets and data-driven variants of existing renderers. A public extension interface, executable custom renderers, and a preview of their real behavior remain requirements for v3. See the readiness list before choosing this kit for an app that needs those capabilities.
