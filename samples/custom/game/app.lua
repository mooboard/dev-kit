local buttons = {}
local last_ms
return {
  start = function()
    state.x = state.x or 64; state.y = state.y or 16; state.dx = state.dx or 1; state.dy = state.dy or 0.6
    state.paddle = state.paddle or 16; state.score = state.score or 0
  end,
  input = function() buttons = input.buttons or {} end,
  pause = function() buttons = {}; last_ms = nil end,
  resume = function() last_ms = nil end,
  stop = function() buttons = {} end,
  frame = function(ctx)
    local step = last_ms and math.max(0, math.min(50, ctx.monoMs - last_ms)) / (1000 / 60) or 1
    last_ms = ctx.monoMs
    if buttons.up then state.paddle = math.max(4, state.paddle - 1.5 * step)
    elseif buttons.down then state.paddle = math.min(27, state.paddle + 1.5 * step)
    else state.paddle = state.paddle + (state.y - state.paddle) * math.min(1, 0.07 * step) end
    state.x = state.x + state.dx * step; state.y = state.y + state.dy * step
    if state.y < 2 or state.y > 29 then state.dy = -state.dy end
    if state.x > 123 then state.dx = -math.abs(state.dx) end
    if state.x < 7 then
      if math.abs(state.y - state.paddle) < 6 then state.dx = math.abs(state.dx); state.score = state.score + 1
      else state.x = 64; state.y = 16; state.score = 0 end
    end
    screen.rect(3, state.paddle - 4, 2, 9, settings.color)
    screen.rect(state.x, state.y, 2, 2, "#ffffff")
    screen.text(tostring(state.score), 96, 9, 6, "#a1b5bd")
  end
}
