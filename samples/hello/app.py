from mooboard import Screen, colors

screen = Screen()
screen.sprite("cow-rest", 4, 4)
screen.text("Hello", x=44, size=13, color=colors.TEAL)
screen.frame(2400)
screen.sprite("cow-blink", 4, 4)
screen.frame(160)
screen.save()
