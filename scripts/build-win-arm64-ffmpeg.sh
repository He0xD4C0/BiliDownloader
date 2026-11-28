#!/usr/bin/env bash
set -euo pipefail

ffmpeg_version=8.1.3
ffmpeg_sha256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3
toolchain_version=20260616
toolchain_sha256=534b92e067b22a6b4441f48ae9240a3341b17825d04d577eab0cf85c44b4deda
toolchain=llvm-mingw-${toolchain_version}-ucrt-ubuntu-22.04-x86_64
source_archive=ffmpeg-${ffmpeg_version}.tar.xz
recipe=$(realpath "$0")
output=$(realpath -m "${1:-dist-electron}")
jobs=${FFMPEG_BUILD_JOBS:-$(nproc)}
work=$(mktemp -d -t bili-ffmpeg.XXXXXXXX)
trap 'rm -rf -- "$work"' EXIT
cd "$work"

download=(curl -fLSs --retry 3 --retry-all-errors --connect-timeout 30 --max-time 180 -O)
if [[ -f $(dirname "$recipe")/$source_archive ]]; then
  cp "$(dirname "$recipe")/$source_archive" .
else
  "${download[@]}" "https://ffmpeg.org/releases/$source_archive"
fi
"${download[@]}" "https://github.com/mstorsjo/llvm-mingw/releases/download/$toolchain_version/$toolchain.tar.xz"
sha256sum -c <<EOF
$ffmpeg_sha256  $source_archive
$toolchain_sha256  $toolchain.tar.xz
EOF
tar -xf "$source_archive"
tar -xf "$toolchain.tar.xz"
export PATH="$work/$toolchain/bin:$PATH"

configure=../ffmpeg-${ffmpeg_version}/configure
common=(--enable-cross-compile --target-os=mingw32 --disable-autodetect --disable-network
  --disable-doc --disable-debug --disable-ffplay --disable-gpl --disable-nonfree
  --enable-static --disable-shared)

mkdir build-arm64
cd build-arm64
"$configure" "${common[@]}" --cross-prefix=aarch64-w64-mingw32- --arch=aarch64
make -j "$jobs" ffmpeg.exe ffprobe.exe
install -D ffmpeg.exe "$output/ffmpeg-win-arm64/ffmpeg.exe"
install -D ffprobe.exe "$output/ffmpeg-validation-arm64/ffprobe.exe"
install -D "../ffmpeg-$ffmpeg_version/COPYING.LGPLv2.1" "$output/ffmpeg-win-arm64/COPYING.LGPLv2.1"
cd ..

cp "$recipe" build-win-arm64-ffmpeg.sh
tar -cJf "$output/ffmpeg-$ffmpeg_version-win-arm64-source.tar.xz" "$source_archive" build-win-arm64-ffmpeg.sh

if [[ ${2:-} == --with-x64-probe ]]; then
  mkdir build-x64-probe
  cd build-x64-probe
  "$configure" "${common[@]}" --cross-prefix=x86_64-w64-mingw32- --arch=x86_64 \
    --disable-x86asm --disable-ffmpeg --disable-everything --enable-ffprobe \
    --enable-protocol=file --enable-demuxer=mov --enable-decoder=h264,hevc,av1,aac \
    --enable-parser=h264,hevc,av1,aac
  make -j "$jobs" ffprobe.exe
  install -D ffprobe.exe "$output/ffmpeg-validation-x64/ffprobe.exe"
fi
