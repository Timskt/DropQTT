import Cocoa

// DropQTT Logo Generator (1024x1024 Master Icon)
// Implements app-logo-design-engine: True 32-bit RGBA PNG (ColorType 6), zero white border.

let masterSize = NSSize(width: 1024, height: 1024)
let image = NSImage(size: masterSize)
image.lockFocus()

guard let ctx = NSGraphicsContext.current?.cgContext else {
    print("Failed to acquire CGContext")
    exit(1)
}

// 1. Clear canvas with 100% Alpha Transparency
ctx.clear(CGRect(origin: .zero, size: masterSize))

// 2. Apple Standard Squircle Dimensions scaled to 1024:
// 512 standard: rect (36, 36, 440, 440), corner 104
// 1024 standard: rect (72, 72, 880, 880), corner 208
let baseRect = CGRect(x: 72, y: 72, width: 880, height: 880)
let basePath = CGPath(roundedRect: baseRect, cornerWidth: 208, cornerHeight: 208, transform: nil)

// 3. Drop Shadow for dark backgrounds & macOS Dock
ctx.saveGState()
ctx.setShadow(
    offset: CGSize(width: 0, height: -28),
    blur: 60,
    color: NSColor(calibratedRed: 0, green: 0, blue: 0, alpha: 0.60).cgColor
)
ctx.addPath(basePath)
ctx.setFillColor(NSColor(calibratedRed: 0.05, green: 0.05, blue: 0.07, alpha: 1.0).cgColor)
ctx.fillPath()
ctx.restoreGState()

// 4. Squircle interior fill & inner border
ctx.saveGState()
ctx.addPath(basePath)
ctx.clip()

let space = CGColorSpaceCreateDeviceRGB()

// Rich dark slate background gradient
let bgColors = [
    NSColor(calibratedRed: 0.11, green: 0.13, blue: 0.18, alpha: 1.0).cgColor,
    NSColor(calibratedRed: 0.05, green: 0.06, blue: 0.09, alpha: 1.0).cgColor
] as CFArray
let bgGrad = CGGradient(colorsSpace: space, colors: bgColors, locations: [0.0, 1.0])!
ctx.drawLinearGradient(bgGrad, start: CGPoint(x: 512, y: 952), end: CGPoint(x: 512, y: 72), options: [])

// Subtle Radial Highlight at the top center
let glowColors = [
    NSColor(calibratedRed: 0.20, green: 0.35, blue: 0.65, alpha: 0.25).cgColor,
    NSColor(calibratedRed: 0.10, green: 0.15, blue: 0.30, alpha: 0.0).cgColor
] as CFArray
let glowGrad = CGGradient(colorsSpace: space, colors: glowColors, locations: [0.0, 1.0])!
ctx.drawRadialGradient(glowGrad, startCenter: CGPoint(x: 512, y: 850), startRadius: 0, endCenter: CGPoint(x: 512, y: 850), endRadius: 400, options: [])

// Inner Squircle Border Highlight (1.5pt crisp stroke)
ctx.setLineWidth(3.0)
ctx.setStrokeColor(NSColor(calibratedRed: 1.0, green: 1.0, blue: 1.0, alpha: 0.14).cgColor)
ctx.addPath(basePath)
ctx.strokePath()

// 5. Draw Central Geometric Metaphor: DropQTT Stream Vectors
// Dual-vector origami chevrons representing packet fragmentation, streaming, and convergence.
// Apply dynamic forward slant of -5 degrees.
ctx.saveGState()
ctx.translateBy(x: 512, y: 512)
var slantTransform = CGAffineTransform(a: 1.0, b: 0.0, c: CGFloat(-tan(5.0 * .pi / 180.0)), d: 1.0, tx: 0, ty: 0)

// Upper Vector: Cyan -> Electric Blue (Packets in flight)
let upperPath = CGMutablePath()
upperPath.move(to: CGPoint(x: -180, y: 160), transform: slantTransform)
upperPath.addLine(to: CGPoint(x: 40, y: 160), transform: slantTransform)
upperPath.addLine(to: CGPoint(x: 180, y: 40), transform: slantTransform)
upperPath.addLine(to: CGPoint(x: 80, y: 40), transform: slantTransform)
upperPath.addLine(to: CGPoint(x: -40, y: 80), transform: slantTransform)
upperPath.addLine(to: CGPoint(x: -180, y: 80), transform: slantTransform)
upperPath.closeSubpath()

let upperColors = [
    NSColor(calibratedRed: 0.05, green: 0.82, blue: 0.95, alpha: 1.0).cgColor, // Cyan
    NSColor(calibratedRed: 0.15, green: 0.45, blue: 0.98, alpha: 1.0).cgColor  // Electric Blue
] as CFArray
let upperGrad = CGGradient(colorsSpace: space, colors: upperColors, locations: [0.0, 1.0])!

ctx.saveGState()
ctx.addPath(upperPath)
ctx.clip()
ctx.drawLinearGradient(upperGrad, start: CGPoint(x: -180, y: 160), end: CGPoint(x: 180, y: 40), options: [])
ctx.restoreGState()

// Middle Interlocking Diamond / Data Packet Core
let corePath = CGMutablePath()
corePath.move(to: CGPoint(x: -40, y: 40), transform: slantTransform)
corePath.addLine(to: CGPoint(x: 80, y: 40), transform: slantTransform)
corePath.addLine(to: CGPoint(x: 160, y: -40), transform: slantTransform)
corePath.addLine(to: CGPoint(x: 40, y: -40), transform: slantTransform)
corePath.closeSubpath()

let coreColors = [
    NSColor(calibratedRed: 0.25, green: 0.55, blue: 1.0, alpha: 1.0).cgColor,
    NSColor(calibratedRed: 0.55, green: 0.25, blue: 0.95, alpha: 1.0).cgColor
] as CFArray
let coreGrad = CGGradient(colorsSpace: space, colors: coreColors, locations: [0.0, 1.0])!

ctx.saveGState()
ctx.addPath(corePath)
ctx.clip()
ctx.drawLinearGradient(coreGrad, start: CGPoint(x: -40, y: 40), end: CGPoint(x: 160, y: -40), options: [])
ctx.restoreGState()

// Lower Vector: Royal Blue -> Violet -> Neon Emerald Accent (Convergence & Integrity)
let lowerPath = CGMutablePath()
lowerPath.move(to: CGPoint(x: 180, y: -160), transform: slantTransform)
lowerPath.addLine(to: CGPoint(x: -40, y: -160), transform: slantTransform)
lowerPath.addLine(to: CGPoint(x: -180, y: -40), transform: slantTransform)
lowerPath.addLine(to: CGPoint(x: -80, y: -40), transform: slantTransform)
lowerPath.addLine(to: CGPoint(x: 40, y: -80), transform: slantTransform)
lowerPath.addLine(to: CGPoint(x: 180, y: -80), transform: slantTransform)
lowerPath.closeSubpath()

let lowerColors = [
    NSColor(calibratedRed: 0.60, green: 0.20, blue: 0.95, alpha: 1.0).cgColor, // Violet
    NSColor(calibratedRed: 0.15, green: 0.45, blue: 0.98, alpha: 1.0).cgColor  // Blue
] as CFArray
let lowerGrad = CGGradient(colorsSpace: space, colors: lowerColors, locations: [0.0, 1.0])!

ctx.saveGState()
ctx.addPath(lowerPath)
ctx.clip()
ctx.drawLinearGradient(lowerGrad, start: CGPoint(x: -180, y: -40), end: CGPoint(x: 180, y: -160), options: [])
ctx.restoreGState()

// Fine line detail highlights (Origami fold lines)
ctx.setLineWidth(2.0)
ctx.setStrokeColor(NSColor(calibratedRed: 1.0, green: 1.0, blue: 1.0, alpha: 0.35).cgColor)
ctx.addPath(upperPath)
ctx.strokePath()
ctx.addPath(corePath)
ctx.strokePath()
ctx.addPath(lowerPath)
ctx.strokePath()

ctx.restoreGState() // restore slant & translate
ctx.restoreGState() // restore squircle clip

image.unlockFocus()

// 6. Export to true RGBA PNG (ColorType 6)
let tiffData = image.tiffRepresentation!
let bitmap = NSBitmapImageRep(data: tiffData)!
let pngData = bitmap.representation(using: .png, properties: [:])!

let outputURL = URL(fileURLWithPath: "app-icon.png")
try pngData.write(to: outputURL)
print("Successfully rendered 1024x1024 master icon to app-icon.png (ColorType 6 RGBA)")
