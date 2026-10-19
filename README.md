# mooboard dev kit

Make screens and apps for mooboard, the 128×32 LED wall display. The previewer shows a picture on the board's LEDs. The composer makes an app by drag and drop. You can also write an app in Python and play it as the board shows it.

## Start

On a Mac, open Terminal (press Command and Space, then type Terminal) and run these lines:

```sh
git clone https://github.com/mooboard/dev-kit.git
cd dev-kit
open previewer/index.html
open composer/index.html
python3 -m mooboard play samples/hello
```

The previewer, the composer and a sample app open in your browser. The app plays after the board's clock.

If git asks to install the command line developer tools, say yes, then run the lines again. They bring Python too. Elsewhere you need git, Python 3.9 or newer and a browser. Open the two index.html files in the browser and type python if python3 is not found.

## Make an app

Change `Hello` in samples/hello/app.py and run the last line again. `open -e samples/hello/app.py` opens the file in TextEdit. The other samples are in samples/ and play the same way.

In the composer's App panel, put your GitHub user name in Author, then press Export. Unzip the download if your browser did not, then play its folder: `python3 -m mooboard play ../Downloads/my-app`. Use your app's ID in place of my-app.

## Draw a screen

Read the [rules](RULES.md) first.

1. Draw your screen on [templates/blank.png](templates/blank.png) in any pixel editor, one pixel for each LED. The board's colors, fonts, sprites and approved screens are in palette/, fonts/, sprites/ and examples/.
2. Drop it on the previewer.
3. Post it in the apps forum on [Discord](https://mooboard.co/discord), then file an [app proposal](https://github.com/mooboard/dev-kit/issues/new?template=app-proposal.yml).

The [previewer](https://mooboard.github.io/dev-kit/previewer/) and the [composer](https://mooboard.github.io/dev-kit/composer/) are online too.

## Check

`python3 tools/check_readme.py` follows this README in a copy of the kit and prints readme: ok. GitHub runs it and `python3 tools/check_clean.py` on every push.

## Help

Ask on the mooboard [Discord](https://mooboard.co/discord).

The Matrix Cow, the logo and the name are reserved for mooboard app designs.
