from mooboard import Screen, colors

STARS = ((60, 4), (90, 6), (118, 3), (70, 27), (100, 28), (122, 26))
GLOW = (0, 1, 2, 3, 2, 1, 0, 0)

screen = Screen()
for step in range(len(GLOW)):
    screen.clear()
    for i, (x, y) in enumerate(STARS):
        level = GLOW[(step + i * 3) % len(GLOW)]
        if level:
            screen.pixel(x, y, tuple(c * level // 3 for c in colors.CREAM))
    screen.frame(250)
screen.save()
