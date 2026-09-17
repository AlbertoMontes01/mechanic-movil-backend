// Identifies an image's real format from its file signature (magic bytes),
// never from the client-supplied filename or Content-Type -- both are
// attacker-controlled and trivial to spoof (e.g. uploading a script with a
// ".png" name and an "image/png" mimetype). Only formats we recognize here
// can ever be written to disk, with an extension WE choose based on the
// signature, not the one the client sent.
const SIGNATURES = [
  { ext: 'png', mime: 'image/png', check: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', check: (b) => b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)) },
  { ext: 'webp', mime: 'image/webp', check: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

// Returns { ext, mime } for a recognized image, or null if the buffer isn't
// one of the formats above (SVG is deliberately not supported -- it can
// carry embedded <script>, defeating the point of this check).
export function detectImageType(buffer) {
  for (const sig of SIGNATURES) {
    if (sig.check(buffer)) return { ext: sig.ext, mime: sig.mime };
  }
  return null;
}
