{ lib, buildNpmPackage, electron_44, makeWrapper, src, slackPackage ? null }:

buildNpmPackage {
  pname = "slick";
  version = "2.0.0-dev";
  inherit src;
  npmDepsHash = "sha256-k5GQpXkYGivPcJsReDKPTdLHl9l3VUXEv2ertBUwQ4o=";
  dontNpmBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  # Electron is supplied by nixpkgs; npm's Electron download is unnecessary.
  ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  SLICK_BUILD = "0";
  SLICK_VERSION = "2.0.0-dev";

  buildPhase = ''
    runHook preBuild
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
    platforms = [ "x86_64-linux" ];
    mainProgram = "slick";
  };
}
