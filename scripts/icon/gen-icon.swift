import AppKit

let insetRatio = 90.0 / 1024.0

guard CommandLine.arguments.count == 3 else {
  fputs("usage: gen-icon.swift <desktop.svg> <output.icns>\n", stderr)
  exit(2)
}

let sourcePath = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]

guard let source = NSImage(contentsOfFile: sourcePath) else {
  fputs("could not read \(sourcePath)\n", stderr)
  exit(1)
}

func pngData(size: Int) -> Data {
  let side = Double(size)
  let inset = side * insetRatio
  let contentSize = side - (inset * 2)

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
  source.draw(
    in: NSRect(x: inset, y: inset, width: contentSize, height: contentSize),
    from: NSRect(origin: .zero, size: source.size),
    operation: .sourceOver,
    fraction: 1,
    respectFlipped: true,
    hints: [.interpolation: NSImageInterpolation.high]
  )
  NSGraphicsContext.restoreGraphicsState()

  guard let png = rep.representation(using: .png, properties: [:]) else {
    fputs("could not render \(size)x\(size) icon\n", stderr)
    exit(1)
  }
  return png
}

func uint32BE(_ value: Int) -> Data {
  var bigEndian = UInt32(value).bigEndian
  return Data(bytes: &bigEndian, count: MemoryLayout<UInt32>.size)
}

func chunk(_ type: String, _ data: Data) -> Data {
  var out = Data(type.utf8)
  out.append(uint32BE(data.count + 8))
  out.append(data)
  return out
}

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

let chunks = entries.map { chunk($0.0, pngData(size: $0.1)) }
let totalSize = 8 + chunks.reduce(0) { $0 + $1.count }
var icns = Data("icns".utf8)
icns.append(uint32BE(totalSize))
chunks.forEach { icns.append($0) }

try! icns.write(to: URL(fileURLWithPath: outputPath))
print("wrote \(outputPath)")
