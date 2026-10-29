return {
  frame = function(ctx)
    local feed = data.feed or {}
    local value = feed.value
    if not value then
      screen.text("Waiting for data", 3, 19, 9, "#a1b5bd")
      return
    end
    screen.text(tostring(value.title or "MY DATA"), 3, 9, 6, settings.color)
    screen.text(tostring(value.value or ""), 3, 27, 13, "#ffffff")
    if feed.status ~= "ok" then screen.pixel(124, 3, "#ff9500") end
  end
}
