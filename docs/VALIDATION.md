# Test your app

Build the package and open the preview:

```sh
python3 -m mooboard build "My App"
python3 -m mooboard play "My App"
```

Try each setting and control.

If the app uses an API, turn on Live data in the preview. Check what it shows while loading and when a request fails.

Enable Developer mode on a board with compatible firmware, then install:

```sh
python3 -m mooboard install "My App" --board mooboard.local
```

For a clock face or ambiance, check the picker preview and selection. For other apps, check rotation and locking.

Check the actual display. Restart the board and check that saved settings and app state return. For games, disconnect the controller and check that held buttons release.

Remove the app when done and check that the board returns to its usual display.
