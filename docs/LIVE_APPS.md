# Live apps

A custom live app contains `mooboard.json` and `app.lua`, plus an optional 32×32 `icon.png`. Lua code runs on the board. The local preview executes the same runtime and drawing code through a native host. It does not substitute a browser animation.

```sh
python3 -m mooboard new "My App" --author YOUR-GITHUB-NAME --category Tools
python3 -m mooboard play "My App"
python3 -m mooboard build "My App"
python3 -m mooboard install "My App" --board mooboard.local
```

Templates: `data`, `clock`, `ambiance`, `game`, `tool`. Edit the generated code, settings, controls and data sources. `new --uses RENDERER` remains available for presets of existing firmware renderers. Those format 2 packages use the existing store submission path.

## App code

```lua
return {
  start = function()
    state.count = state.count or 0
  end,
  input = function()
    if input.control == "add" then state.count = state.count + 1 end
  end,
  frame = function(ctx)
    screen.text(settings.label, 3, 9, 6, "#77edd7")
    screen.text(tostring(state.count), 3, 27, 13, "#ffffff")
  end
}
```

Return a table with a `frame` function. Optional callbacks are `start`, `input`, `data`, `settings`, `pause`, `resume` and `stop`. Settings, data, input and state are available as global tables. Declare button controls in the manifest to receive their keys as `input.control`. Game input is in `input.buttons`, with `up`, `down`, `left`, `right`, `a` and `b`. The controller page supports touch, keyboard and paired gamepads. A disconnected controller releases its buttons within one second.

`state` is a JSON object of at most 2 KB. It survives display turns and is checkpointed every ten seconds. A sudden loss of power may lose the most recent changes. Local variables last for the current app instance. Use state for values that must survive leaving the screen.

## Drawing and time

- `screen.clear(color)`
- `screen.pixel(x, y, color)`
- `screen.line(x1, y1, x2, y2, color)`
- `screen.rect(x, y, width, height, color, fill)`
- `screen.circle(x, y, radius, color)`
- `screen.text(words, x, baseline, size, color)`

Colors are `#rrggbb` strings or RGB integers. Text sizes are 6, 8, 9, 11 and 13. The bundled font is the same in the native preview and board runtime. Drawing clips to the display. Coordinates must be between -4096 and 4096.

`ctx` includes `monoMs`, `elapsedMs`, `epochSec`, `timeValid`, local `year`, `month`, `day`, `weekday`, `hour`, `minute`, `second`, plus `clock24`, `seconds`, `night` and `online`. Weekday is Sunday 0 through Saturday 6. Use monotonic time for animation and durations. Use local wall time for clocks. Check timeValid before showing a clock.

## Settings and controls

Declare up to eight settings: text, toggle, color or choice. Text settings have a maximum of 1 to 256 characters. A choice has 2 to 8 options. Declare up to sixteen button, stepper, readout or list controls. The board and preview build their UI from these declarations. Button events include `control` and optional `arg`. Steppers include `control` and `by` (1 or -1). List events include `control`, `action` ending in `-add`, `-tap` or `-remove`, and `text` or a zero-based `item`. Readouts and lists render the corresponding key from `state`. Clamp stepper values to the declared range and enforce list capacity in app logic.

Clock and Ambiance apps are selected in their respective pickers and expose settings through a pencil. Other apps can take turns, remain locked, or temporarily appear while their sheet is open. Removing an app removes its picker entry and restores normal display behavior.

## Runtime limits

The runtime uses Lua 5.4 text source, at most 64 KB. Each instance has a 512 KB allocation budget and each callback an instruction budget and a shared drawing and native-library work budget. Budget violations stop the app with an error. Large sorts, concatenations and UTF-8 scans consume work even when they run in native library code. Move large data transformations to your API or process them incrementally in Lua.

The app has base operations and math, string, table and UTF-8 helpers. There is no filesystem, process execution, module loading, debug access or direct network IO. The host fetches declared feeds on its network task. The same limits apply to preview and firmware. String pattern functions, `table.move`, protected calls and metatable mutation are unavailable. Use simple string operations and explicit bounded loops.

## Package formats

Custom live apps use format 3: manifest, Lua source and icon in a deterministic stored ZIP. The builder runs the app before packaging. Credentials and sample data are excluded. Developer mode accepts the package from the CLI, Add from file, or the existing repository release mechanism.

Format 1 picture/GIF apps and the composer remain supported. Python in a picture app runs on the build computer and produces frames. Format 2 packages configure native firmware renderers and do not contain custom app code.
