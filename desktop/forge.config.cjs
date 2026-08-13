const path = require("node:path");
const fs = require("node:fs");

module.exports = {
  packagerConfig: {
    asar: { unpack: "**/*.node" },
    executableName: "SKRC-Competition-Day",
    extraResource: [
      path.resolve(__dirname, "resources/frontend"),
      path.resolve(__dirname, "competition-day.example.env"),
    ],
  },
  rebuildConfig: {},
  hooks: {
    // serialport ships signed N-API prebuilds for Windows. Removing the host
    // rebuild makes both native Windows builds and Linux cross-packages select
    // prebuilds/win32-x64 rather than accidentally carrying a host .node file.
    packageAfterPrune: async (_config, buildPath, _electronVersion, platform, arch) => {
      if (platform !== "win32" || arch !== "x64") return;
      const bindings = path.join(buildPath, "node_modules", "@serialport", "bindings-cpp");
      fs.rmSync(path.join(bindings, "build"), { recursive: true, force: true });
      fs.rmSync(path.join(bindings, "bin"), { recursive: true, force: true });
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "skrc_competition_day",
        setupExe: "SKRC-Competition-Day-Setup.exe",
        noMsi: true,
      },
    },
  ],
};
