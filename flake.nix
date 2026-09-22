{
  description = "Slick, a Slack client mod (bring your own Slack)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      slick = pkgs.callPackage ./packaging/nix { src = self; };
    in {
      packages.${system} = { inherit slick; default = slick; };
      overlays.default = final: prev: {
        slick = final.callPackage ./packaging/nix { src = self; };
      };
      apps.${system}.default = {
        type = "app";
        program = "${slick}/bin/slick";
        meta.description = "Run Slick with an installed Slack app";
      };
    };
}
