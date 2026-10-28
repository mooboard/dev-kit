# Rules

Use the same category as the store. The category controls where an app appears. It does not supply its behavior.

| Category | Behavior |
| --- | --- |
| Lifestyle | Information, routines, companions and everyday screens. Explain what it shows and how its data stays current. |
| Ambiance | A continuous visual that appears in Ambiance with a working preview and its own settings. Loop smoothly. |
| Games | Implement the actual game rules. Provide autonomous play for normal display use, responsive controls and release held input when a controller disconnects. |
| Tools | Perform the stated function with real data or state. Declare settings and controls. Use the board's rotation, lock and open/close lifecycle. |
| Clock Faces | A live clock face in Clock's picker, with a working preview and face settings. Read the board's local time and 12/24-hour and seconds preferences. |
| AI | Implement the stated AI behavior and identify the external service or model it needs. Show useful loading, unavailable and stale-data states. |

Category definitions are exported from the store when the kit is built. The kit does not introduce a separate category scheme.

- Draw for 128×32 LEDs. Black turns an LED off. Check contrast and very dim colors on the actual display.
- Animate using elapsed or monotonic time. Network requests must not block rendering.
- Store durable app state in `state`. Do not assume an app stays visible between turns.
- App settings and controls must describe behavior the app actually implements.
- API-backed apps must show when data is unavailable or old. Keep credentials out of source, sample data and packages.
- Use the board's lifecycle. A persistent lock ends only when unlocked or removed. Rotation resumes its previous state after unlocking. The board retains its night, rest and higher-priority modes.
- Include only artwork, data and code you may distribute. The runtime's bundled dependency licenses remain included.

Test source edit, build, preview, settings, input, installation, operation, restart and removal before submitting.
