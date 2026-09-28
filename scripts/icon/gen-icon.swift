import AppKit

let insetRatio = 90.0 / 1024.0
let icoInsetRatio = 32.0 / 256.0
let icoCornerRatio = 0.225
let linuxSizes = [16, 32, 64, 128, 256, 512, 1024]
let icoSizes = [256, 128, 64, 48, 32, 16]

guard CommandLine.arguments.count == 3 else {
  fputs("usage: gen-icon.swift <desktop.svg> <assets-dir>\n", stderr)
  exit(2)
}

let sourcePath = CommandLine.arguments[1]
let assetsDir = URL(fileURLWithPath: CommandLine.arguments[2])

guard let source = NSImage(contentsOfFile: sourcePath) else {
  fputs("could not read \(sourcePath)\n", stderr)
  exit(1)
}

func render(size: Int, _ draw: (Double) -> Void) -> Data {
  let side = Double(size)
  guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ), let context = NSGraphicsContext(bitmapImageRep: rep) else {
    fputs("could not create \(size)x\(size) bitmap\n", stderr)
    exit(1)
  }
  rep.size = NSSize(width: side, height: side)

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.imageInterpolation = .high
  draw(side)
  NSGraphicsContext.restoreGraphicsState()

  guard let png = rep.representation(using: .png, properties: [:]) else {
    fputs("could not render \(size)x\(size) icon\n", stderr)
    exit(1)
  }
  return png
}

func drawMark(side: Double, inset: Double) {
  source.draw(
    in: NSRect(x: inset, y: inset, width: side - inset * 2, height: side - inset * 2),
    from: NSRect(origin: .zero, size: source.size),
    operation: .sourceOver,
    fraction: 1,
    respectFlipped: true,
    hints: [.interpolation: NSImageInterpolation.high]
  )
}

func markPNG(size: Int) -> Data {
  render(size: size) { side in drawMark(side: side, inset: side * insetRatio) }
}

func tilePNG(size: Int) -> Data {
  render(size: size) { side in
    let radius = side * icoCornerRatio
    NSColor.white.setFill()
    NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: side, height: side), xRadius: radius, yRadius: radius).fill()
    drawMark(side: side, inset: side * icoInsetRatio)
  }
}

func uint32BE(_ value: Int) -> Data {
  var bigEndian = UInt32(value).bigEndian
  return Data(bytes: &bigEndian, count: 4)
}

func uint16LE(_ value: Int) -> Data {
  var little = UInt16(value).littleEndian
  return Data(bytes: &little, count: 2)
}

func uint32LE(_ value: Int) -> Data {
  var little = UInt32(value).littleEndian
  return Data(bytes: &little, count: 4)
}

func write(_ data: Data, _ relative: String) {
  let url = assetsDir.appendingPathComponent(relative)
  try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  try! data.write(to: url)
  print("wrote \(url.path)")
}

func icns() -> Data {
  let entries: [(String, Int)] = [
    ("ic04", 16),
    ("ic11", 32),
    ("ic05", 32),
    ("ic12", 64),
    ("ic07", 128),
    ("ic13", 256),
    ("ic08", 256),
    ("ic14", 512),
    ("ic09", 512),
    ("ic10", 1024),
  ]
  let chunks = entries.map { entry -> Data in
    let png = markPNG(size: entry.1)
    var out = Data(entry.0.utf8)
    out.append(uint32BE(png.count + 8))
    out.append(png)
    return out
  }
  var out = Data("icns".utf8)
  out.append(uint32BE(8 + chunks.reduce(0) { $0 + $1.count }))
  chunks.forEach { out.append($0) }
  return out
}

func ico() -> Data {
  let images = icoSizes.map { tilePNG(size: $0) }
  var out = uint16LE(0) + uint16LE(1) + uint16LE(images.count)
  var offset = 6 + 16 * images.count
  for (size, png) in zip(icoSizes, images) {
    out.append(contentsOf: [UInt8(size % 256), UInt8(size % 256), 0, 0])
    out.append(uint16LE(1) + uint16LE(32) + uint32LE(png.count) + uint32LE(offset))
    offset += png.count
  }
  images.forEach { out.append($0) }
  return out
}

write(icns(), "desktop.icns")
for size in linuxSizes { write(markPNG(size: size), "desktop-linux/\(size).png") }
write(ico(), "icon.ico")
