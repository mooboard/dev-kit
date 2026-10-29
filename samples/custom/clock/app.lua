return {
  frame = function(ctx)
    if not ctx.timeValid then screen.text("Setting time", 3, 23, 9, "#a1b5bd") return end
    local hour = ctx.hour
    if not ctx.clock24 then hour = (hour + 11) % 12 + 1 end
    local words = string.format(ctx.clock24 and "%02d:%02d" or "%d:%02d", hour, ctx.minute)
    if ctx.seconds and settings.seconds then words = words .. string.format(":%02d", ctx.second) end
    screen.text(words, 4, 25, 13, settings.color)
  end
}
