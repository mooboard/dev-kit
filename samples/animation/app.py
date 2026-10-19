from mooboard import Screen, colors

FRAMES = 60
SIZE = 3


def bounce(t, low, high):
    phase = (t % FRAMES) / FRAMES
    return low + round((high - low) * (1 - abs(1 - 2 * phase)))


screen = Screen()
for t in range(FRAMES):
    screen.clear()
    for age in range(4, -1, -1):
        x = bounce(t - age, 1, 127 - SIZE)
        y = bounce(2 * (t - age), 1, 31 - SIZE)
        shade = tuple(c * (5 - age) // 5 for c in colors.TEAL)
        screen.rect(x, y, SIZE, SIZE, shade)
    screen.frame(30)
screen.save()
