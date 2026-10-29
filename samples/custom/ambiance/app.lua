return {
  frame = function(ctx)
    local speed = settings.speed == "Slow" and 0.01 or settings.speed == "Fast" and 0.05 or 0.025
    for i = 1, 12 do
      local x = (ctx.monoMs * speed + i * 17) % 136 - 4
      local y = 16 + math.sin(ctx.monoMs / 900 + i) * 11
      screen.circle(x, y, 2, settings.color)
    end
  end
}
