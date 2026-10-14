const { MakerBase } = require("@electron-forge/maker-base");
const { buildForge } = require("app-builder-lib");
const fs = require("fs");
const path = require("path");

module.exports = class NsisMaker extends MakerBase {
  constructor(config, platformsToMakeOn) {
    super(config, platformsToMakeOn);
    this.name = "nsis";
    this.defaultPlatforms = ["win32"];
  }

  isSupportedOnCurrentPlatform() {
    return process.platform === "win32";
  }

  async make({ dir, makeDir, targetArch }) {
    const projectRoot = path.resolve(__dirname, "..");
    const buildResources = path.join(projectRoot, "build");

    return buildForge(
      { dir },
      {
        win: [`nsis:${targetArch}`],
        config: {
          directories: {
            output: makeDir,
            buildResources,
          },
          nsis: {
            oneClick: false,
            perMachine: false,
            allowToChangeInstallationDirectory: true,
            runAfterFinish: true,
            createDesktopShortcut: true,
            createStartMenuShortcut: true,
            shortcutName: "Vendia",
            installerIcon: path.join(buildResources, "Icon.ico"),
            uninstallerIcon: path.join(buildResources, "Icon.ico"),
            installerHeader: path.join(buildResources, "installerHeader.bmp"),
            installerSidebar: path.join(buildResources, "installerSidebar.bmp"),
            uninstallerSidebar: path.join(buildResources, "installerSidebar.bmp"),
            include: path.resolve(__dirname, "nsis-custom.nsh"),
            artifactName: "VendiaSetup.${ext}",
          },
          publish: [
            {
              provider: "github",
              owner: "jrpcore-dev",
              repo: "pos-desktop-electron",
            },
          ],
        },
      }
    ).then((result) => {
      const artifactPaths = result && result.artifactPaths ? [...result.artifactPaths] : [];
      const add = (file) => {
        if (fs.existsSync(file) && !artifactPaths.includes(file)) {
          artifactPaths.push(file);
        }
      };
      add(path.join(makeDir, "latest.yml"));
      for (const file of fs.readdirSync(makeDir)) {
        if (file.endsWith(".exe") || file.endsWith(".blockmap")) {
          add(path.join(makeDir, file));
        }
      }
      return artifactPaths;
    });
  }
};