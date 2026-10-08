%global slick_version 2.0.100
%global build_number %(echo %{slick_version} | rev | cut -d. -f1 | rev)

Name:           slick
Version:        %{slick_version}
Release:        1%{?dist}
Summary:        Slack client mod (BYOE — Bring Your Own Electron)
License:        GPL-3.0-only
URL:            https://github.com/3kh0/slick

Source0:        https://github.com/3kh0/slick/releases/download/v%{build_number}/Slick-%{slick_version}-linux-x64.tar.gz
Source1:        slick.desktop
Source2:        slick.metainfo.xml

%global debug_package %{nil}
AutoReqProv:    no

Requires:       slack

ExclusiveArch:  x86_64

%description
Slick runs Slack's own app.asar inside its own Electron (BYOE). Slick's code
runs before Slack's bundle and patches Slack from the inside — through its
module system, React, and Redux — rather than by poking at the page afterwards.
Slack's files are never altered, both apps keep updating, and there's no open
debug port or resident watcher.

%prep
%setup -q -n Slick

%install
# Application directory
install -d %{buildroot}/opt/slick
cp -a . %{buildroot}/opt/slick/

# Symlink into PATH
install -d %{buildroot}%{_bindir}
ln -s /opt/slick/slick %{buildroot}%{_bindir}/slick

# Desktop file
install -Dm644 %{SOURCE1} %{buildroot}%{_datadir}/applications/dev.slick.Slick.desktop

# Icons (bundled in the tarball under resources/icons/)
for size in 64 128 256 512; do
  if [ -f resources/icons/${size}.png ]; then
    install -Dm644 resources/icons/${size}.png \
      %{buildroot}%{_datadir}/icons/hicolor/${size}x${size}/apps/dev.slick.Slick.png
  fi
done

# AppStream metadata (shows up in GNOME Software / KDE Discover)
install -Dm644 %{SOURCE2} %{buildroot}%{_metainfodir}/dev.slick.Slick.metainfo.xml

%files
/opt/slick/
%{_bindir}/slick
%{_datadir}/applications/dev.slick.Slick.desktop
%{_datadir}/icons/hicolor/*/apps/dev.slick.Slick.png
%{_metainfodir}/dev.slick.Slick.metainfo.xml

%changelog
* Wed Oct 07 2026 Slick contributors <github@3kh0.net> - 2.0.100-1
- Initial COPR package
