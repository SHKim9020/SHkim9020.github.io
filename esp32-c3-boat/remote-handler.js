(() => {
  "use strict";

  function bindRemoteSpeedToMoves(steps) {
    if (!Array.isArray(steps)) return [];
    return steps.map(step => {
      const next = { ...step };
      if (next.op === "move") next.speed = { type: "remoteSpeed" };
      if (Array.isArray(next.steps)) next.steps = bindRemoteSpeedToMoves(next.steps);
      if (Array.isArray(next.elseSteps)) next.elseSteps = bindRemoteSpeedToMoves(next.elseSteps);
      if (Array.isArray(next.branches)) {
        next.branches = next.branches.map(branch => ({
          ...branch,
          steps: bindRemoteSpeedToMoves(branch.steps)
        }));
      }
      return next;
    });
  }

  globalThis.bindRemoteSpeedToMoves = bindRemoteSpeedToMoves;
})();
