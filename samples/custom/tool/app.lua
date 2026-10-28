return {
  start = function() state.count = state.count or 0 end,
  input = function()
    if input.control == "add" then state.count = state.count + 1 end
    if input.control == "reset" then state.count = 0 end
  end,
  frame = function(ctx)
    screen.text(settings.label, 3, 9, 6, "#77edd7")
    screen.text(tostring(state.count), 3, 27, 13, "#ffffff")
  end
}
