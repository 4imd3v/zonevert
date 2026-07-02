(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  root.ZonevertProgressParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // FFmpeg stderr progress lines look like:
  //   frame=  123 fps= 45 q=28.0 size=    1024kB time=00:00:05.12 bitrate=1638.4kbits/s
  const frameRegex = /frame=\s*(\d+)/;
  const fpsRegex = /fps=\s*(\d+\.?\d*)/;
  const timeRegex = /time=\s*(\d{2}:\d{2}:\d{2}\.\d{2})/;
  const sizeRegex = /size=\s*(\d+)kB/;

  function parseLine(line) {
    const text = String(line || "");
    const frameMatch = text.match(frameRegex);
    const fpsMatch = text.match(fpsRegex);
    const timeMatch = text.match(timeRegex);
    const sizeMatch = text.match(sizeRegex);

    if (!frameMatch && !fpsMatch && !timeMatch && !sizeMatch) {
      return null;
    }

    return {
      frame: frameMatch ? Number.parseInt(frameMatch[1], 10) : null,
      fps: fpsMatch ? Number.parseFloat(fpsMatch[1]) : null,
      time: timeMatch ? timeMatch[1] : null,
      sizeKb: sizeMatch ? Number.parseInt(sizeMatch[1], 10) : null
    };
  }

  function parseStderr(text) {
    const lines = String(text || "").split(/\r?\n/);
    let last = null;

    for (const line of lines) {
      const parsed = parseLine(line);
      if (parsed) {
        last = parsed;
      }
    }

    return last;
  }

  // timeToSeconds: "00:00:05.12" -> 5.12
  function timeToSeconds(timeStr) {
    if (!timeStr || typeof timeStr !== "string") {
      return null;
    }

    const parts = timeStr.split(":");
    if (parts.length !== 3) {
      return null;
    }

    const hours = Number.parseFloat(parts[0]) || 0;
    const minutes = Number.parseFloat(parts[1]) || 0;
    const seconds = Number.parseFloat(parts[2]) || 0;

    return hours * 3600 + minutes * 60 + seconds;
  }

  return {
    parseLine,
    parseStderr,
    timeToSeconds
  };
});
