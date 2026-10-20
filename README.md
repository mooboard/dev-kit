# mooboard dev-kit v2.0

Make screens and apps for mooboard, a 128×32 matrix LED display.

This kit includes: 
- a previewer: renders a picture/GIF on the board's LEDs
- a composer: builds an app via drag and drop

You can also build apps with Python and render them on the board previewer.

## Start (MacOS)

Open Terminal and run these lines:

```sh
git clone https://github.com/mooboard/dev-kit.git
cd dev-kit
open previewer/index.html
open composer/index.html
python3 -m mooboard play samples/hello
```

The previewer, the composer, and a sample app will all open in your browser.
Requires git, Python 3.9 or newer, and a browser.

## Create your first app

In samples/hello/app.py, change `Hello` to your desired text. Run `python3 -m mooboard play samples/hello` again to view your app folder.

## To export

In the composer's App panel, put your GitHub user name in Author, then press Export. 

## To test

Unzip the download if your browser does not, then play its folder: `python3 -m mooboard play ../Downloads/my-app`. Replace my-app with the name of your app.

## To publish

Read the [rules](RULES.md) first.

1. Draw or render your screens on [this](templates/blank.png) (or similar) template in any pixel editor. The board's colors, fonts, sprites and approved screens are in the repo.
2. Drop it on the previewer to test.
3. Post it in the [apps forum](https://discord.com/channels/1559692577538707508/1559708612031680533) on [Discord](https://mooboard.co/discord), then file an [app proposal](https://github.com/mooboard/dev-kit/issues/new?template=app-proposal.yml).

The [previewer](https://mooboard.github.io/dev-kit/previewer/) and the [composer](https://mooboard.github.io/dev-kit/composer/) are also websites.

## Help

Ask on the mooboard [Discord](https://mooboard.co/discord).
