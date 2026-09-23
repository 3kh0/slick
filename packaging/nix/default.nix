{
  lib,
  stdenvNoCC,
  bun,
  nodejs,
  electron_44,
  makeWrapper,
  src,
  slackPackage ? null,
}:

let
  nodeModules = stdenvNoCC.mkDerivation {
    pname = "slick-node-modules";
    version = "2.0.0-dev";
    inherit src;
    nativeBuildInputs = [ bun ];
    dontConfigure = true;
    dontBuild = true;
    # Patched shebangs would reference the store, which a fixed-output path may not.
    dontFixup = true;
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-4YnUihrb5Gg7pQXDFtvTro1XL1fW3U6ZhRbvOrFfrvY=";
    installPhase = ''
      export HOME="$TMPDIR/home"
      export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"
      export ELECTRON_SKIP_BINARY_DOWNLOAD=1
      bun install --frozen-lockfile --ignore-scripts --cpu=x64 --os=linux
      rm -rf node_modules/.cache node_modules/.bun
      mkdir -p $out
      cp -a node_modules $out/
    '';
  };
in
stdenvNoCC.mkDerivation {
  pname = "slick";
  version = "2.0.0-dev";
  inherit src;
  nativeBuildInputs = [ nodejs makeWrapper ];
  dontConfigure = true;

  SLICK_BUILD = "0";
  SLICK_VERSION = "2.0.0-dev";

  buildPhase = ''
    runHook preBuild
    ln -s ${nodeModules}/node_modules node_modules
    node scripts/build.ts desktop
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/slick/resources/app $out/bin
    cp -r dist/desktop/. $out/lib/slick/resources/app/
    cp -r themes $out/lib/slick/resources/themes
    cp dist/desktop/slick.js $out/lib/slick/resources/slick.js
    cp -r dist/desktop/monaco $out/lib/slick/resources/monaco
    makeWrapper ${electron_44}/bin/electron $out/bin/slick \
      --add-flags "$out/lib/slick/resources/app" \
      --set SLICK_RESOURCES_PATH "$out/lib/slick/resources" \
      ${lib.optionalString (slackPackage != null) ''--set SLICK_SLACK_RESOURCES "${slackPackage}/lib/slack/resources"''}
    install -Dm644 packaging/flatpak/dev.slick.Slick.desktop $out/share/applications/dev.slick.Slick.desktop
    for icon in assets/desktop-linux/*.png; do
      size=$(basename "$icon" .png)
      install -Dm644 "$icon" "$out/share/icons/hicolor/''${size}x''${size}/apps/dev.slick.Slick.png"
    done
    runHook postInstall
  '';
  meta = {
    description = "Slack client mod using an installed official Slack";
    homepage = "https://github.com/3kh0/slick";
    license = lib.licenses.gpl3Only;
    platforms = [ "x86_64-linux" ];
    mainProgram = "slick";
  };
}
