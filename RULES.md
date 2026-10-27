# Rules

These category rules are a draft for v3. The release awaits the owner's approval.

| Category | Rules |
| --- | --- |
| Games | A real game or game simulation. Show autonomous play during its normal turn. Support the board's pad when the renderer provides it. Keep input responsive and release held buttons on disconnect. Name the actual game behavior. |
| Ambiance | Continuous visuals that work without interaction. Loop without abrupt resets. Settings may change speed, palette, or scene. Reactive visuals must explain their input and provide a quiet fallback. |
| Clock Faces | Display the board's current local time and join Clock's face picker. Follow 12/24-hour, seconds, night, and rest settings where supported. A recorded clock or a renamed ambiance renderer is not a clock face. Installation support is pending. |
| Tools | Perform the stated function with real state and controls. Running timers and scores must remain accurate across screen changes. Define pause, resume, cancel, and completion where relevant. A hold belongs to the renderer's lifecycle. |
| Misc | Open to experiments, information, companions, and other ideas. Explain what it does, what data it needs, and how it joins or leaves the rotation. The shared display, package, and lifecycle rules still apply. |

The builder checks supported categories, renderer keys, settings, controls, data, firmware minimums, and package limits. Visual quality, behavior, and accuracy also need review on a board.

- 128×32 where every pixel is an LED. Black = Off. Try to build within these dimensions to prevent overscan. Peeking on purpose is fine.
- Animate at the board's frame rate (33 ms frames), so nothing jumps or flickers.
- Very dim colors may not show. The previewer will flag them. Use your best judgement.
- The Matrix Cow's use outside of official apps may be flagged for publishing during review.
