import datetime

from mooboard import Screen, colors

DAYS = "MON TUE WED THU FRI SAT SUN".split()

# The time and date come from when the app is built. GitHub builds it in UTC.
now = datetime.datetime.now()
screen = Screen()
screen.text("%d:%02d" % ((now.hour + 11) % 12 + 1, now.minute), y=19, size=13, color=colors.WHITE)
screen.text("%s %d" % (DAYS[now.weekday()], now.day), y=28, size=6, color=colors.MARIGOLD)
screen.save()
