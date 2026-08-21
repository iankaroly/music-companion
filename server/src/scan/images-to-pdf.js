// A stack of photographs -> one PDF, one page each.
//
// WHY THE PIPELINE WANTS THIS: a PDF is not a nicer wrapper, it is a different
// kind of input. It can be many pages, its resolution is ours to choose, a page
// that fails can be re-rendered bigger and retried, and a failed page falls
// back to page-by-page instead of failing the job. Photographing six pages of a
// part gives you six files with no relationship to each other; this is what
// turns them into a document with a page 1 and a page 6.
//
// WHY IT EMBEDS RATHER THAN CONVERTS: the images go into the PDF BYTE FOR BYTE.
// A JPEG becomes a /DCTDecode stream — the same compressed data, unpacked by
// the reader. A PNG's IDAT is already a zlib stream with PNG row predictors,
// and PDF understands exactly that (/FlateDecode with /Predictor 15), so it
// goes in whole too. Nothing is decoded, re-encoded, resized or re-compressed,
// so nothing is lost on the way in — which matters, because the next thing to
// read these pixels is an OMR engine measuring the thickness of staff lines.
//
// WHAT IT WILL NOT DO: guess. An image it cannot embed losslessly (a palette
// PNG, 16-bit, interlaced, an alpha channel, a TIFF) is refused by name rather
// than silently flattened.

import { Buffer } from 'node:buffer';

const A4_POINTS = { width: 595.28, height: 841.89 };

/** JPEG start-of-frame markers, which carry the size and component count. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Read a JPEG's dimensions and colour space without decoding it.
 *
 * Walking the marker segments is the whole job: each is 0xFF, a type, then a
 * big-endian length. The first start-of-frame carries height, width and the
 * number of components (1 grey, 3 colour, 4 CMYK).
 */
function readJpeg(buffer) {
  if (buffer.readUInt16BE(0) !== 0xffd8) throw new Error('not a JPEG');
  let at = 2;
  while (at < buffer.length - 1) {
    if (buffer[at] !== 0xff) { at += 1; continue; }        // skip fill bytes
    const marker = buffer[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const length = buffer.readUInt16BE(at + 2);
    if (SOF_MARKERS.has(marker)) {
      const bits = buffer[at + 4];
      const height = buffer.readUInt16BE(at + 5);
      const width = buffer.readUInt16BE(at + 7);
      const components = buffer[at + 9];
      if (bits !== 8) throw new Error(`this JPEG is ${bits}-bit; only 8-bit is supported`);
      return { width, height, components };
    }
    at += 2 + length;
  }
  throw new Error('this JPEG has no start-of-frame segment');
}

/**
 * Read a PNG's header and concatenate its IDAT chunks.
 *
 * The IDAT stream is left compressed: PDF can inflate it and undo the PNG row
 * filters itself, given /Predictor 15. That is why this is lossless AND cheap.
 */
function readPng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8;
  let header = null;
  const idat = [];

  while (at + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colourType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;

    at += 12 + length;   // length + type + data + CRC
  }

  if (!header) throw new Error('this PNG has no header chunk');
  if (header.interlace) throw new Error('interlaced PNGs cannot be embedded without decoding them');
  if (header.bitDepth !== 8) throw new Error(`this PNG is ${header.bitDepth}-bit; only 8-bit is supported`);
  // 0 = greyscale, 2 = RGB. 3 is a palette and 4/6 carry alpha, none of which a
  // PDF image stream takes directly.
  if (header.colourType !== 0 && header.colourType !== 2) {
    throw new Error(`this PNG has colour type ${header.colourType} (palette or alpha), which cannot be embedded directly`);
  }
  return { ...header, colours: header.colourType === 0 ? 1 : 3, data: Buffer.concat(idat) };
}

/** What one image contributes to the PDF. */
function describe(buffer, name) {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const { width, height, components } = readJpeg(buffer);
    return {
      name,
      width,
      height,
      data: buffer,
      filter: '/DCTDecode',
      colourSpace: components === 1 ? '/DeviceGray' : components === 4 ? '/DeviceCMYK' : '/DeviceRGB',
      decodeParms: null,
    };
  }
  if (buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47) {
    const png = readPng(buffer);
    return {
      name,
      width: png.width,
      height: png.height,
      data: png.data,
      filter: '/FlateDecode',
      colourSpace: png.colours === 1 ? '/DeviceGray' : '/DeviceRGB',
      // PDF undoes the PNG row filters itself. This is the line that makes a
      // PNG embeddable without decoding it.
      decodeParms: `<< /Predictor 15 /Colors ${png.colours} /BitsPerComponent 8 /Columns ${png.width} >>`,
    };
  }
  throw new Error(`${name} is not a JPEG or a PNG`);
}

/**
 * The page rectangle for an image: A4, or the image's own aspect if it is
 * wildly different.
 *
 * A photograph of a page is roughly page-shaped, so A4 with the image fitted
 * inside it keeps the physical scale an OMR engine expects when the PDF is
 * later rendered at 300 dpi. Something far off A4 gets a page of its own shape
 * instead of being letterboxed into a strip.
 */
function pageBox(image) {
  const imageRatio = image.width / image.height;
  const a4Ratio = A4_POINTS.width / A4_POINTS.height;
  if (Math.abs(imageRatio - a4Ratio) < 0.35) {
    // Close enough to A4: use A4, in the matching orientation.
    return imageRatio > 1
      ? { width: A4_POINTS.height, height: A4_POINTS.width }
      : { ...A4_POINTS };
  }
  // Otherwise a page shaped like the image, sized so 1 image pixel is 1/150 in.
  const scale = 72 / 150;
  return { width: image.width * scale, height: image.height * scale };
}

/**
 * Build a PDF with one image per page.
 *
 * @param {{buffer:Buffer, name?:string}[]} images in page order
 * @returns {Buffer} the PDF
 */
/**
 * How big the picture is, without decoding it.
 *
 * Exported so a caller re-rendering a photograph can work out what scale it is
 * asking for: a page rendered at a fixed dpi blows a small photograph up by
 * whatever factor happens to fall out, which is how a page came back at an
 * interline of 32 when Audiveris wanted about 18.
 *
 * @param {Buffer} buffer
 * @returns {{width:number, height:number}|null}
 */
export function imageSize(buffer) {
  try {
    if (buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47) return readPng(buffer);
    return readJpeg(buffer);
  } catch {
    return null;
  }
}

export function imagesToPdf(images) {
  if (!images?.length) throw new Error('no images to put in a PDF');

  const described = images.map((image, i) => describe(image.buffer, image.name ?? `image ${i + 1}`));

  // A PDF is a list of numbered objects and a table of where each one starts.
  // Objects: 1 catalogue, 2 page tree, then per page a page object, a content
  // stream and the image itself.
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };   // 1-based

  const pageIds = [];
  const pageObjects = [];

  for (const image of described) {
    const box = pageBox(image);
    // Fit the image inside the page, centred, keeping its aspect ratio.
    const scale = Math.min(box.width / image.width, box.height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const x = (box.width - drawWidth) / 2;
    const y = (box.height - drawHeight) / 2;

    const imageId = add({
      dict: `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} `
        + `/ColorSpace ${image.colourSpace} /BitsPerComponent 8 /Filter ${image.filter}`
        + `${image.decodeParms ? ` /DecodeParms ${image.decodeParms}` : ''} /Length ${image.data.length} >>`,
      stream: image.data,
    });
    // `cm` sets the transform, `Do` paints the image into the unit square.
    const content = Buffer.from(`q ${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} `
      + `${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q\n`, 'latin1');
    const contentId = add({ dict: `<< /Length ${content.length} >>`, stream: content });

    pageObjects.push({ box, imageId, contentId });
  }

  // The page objects have to know the page tree's id, so they are added after
  // it is reserved: object 1 is the catalogue, object 2 the page tree.
  const catalogueId = 1;
  const pagesId = 2;
  const offsetForPages = objects.length;

  for (const page of pageObjects) {
    pageIds.push(add({
      dict: `<< /Type /Page /Parent ${pagesId + offsetForPages + 0} 0 R `
        + `/MediaBox [0 0 ${page.box.width.toFixed(2)} ${page.box.height.toFixed(2)}] `
        + `/Resources << /XObject << /Im0 ${page.imageId} 0 R >> >> `
        + `/Contents ${page.contentId} 0 R >>`,
    }));
  }

  // Now the two fixed objects, at the end of the list but numbered so the page
  // objects' /Parent references land on the page tree.
  const pagesObjectId = add({
    dict: `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
  });
  const catalogueObjectId = add({ dict: `<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>` });

  // Fix up the /Parent references now that the page tree's real id is known.
  for (const id of pageIds) {
    objects[id - 1].dict = objects[id - 1].dict.replace(/\/Parent \d+ 0 R/, `/Parent ${pagesObjectId} 0 R`);
  }

  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let length = chunks[0].length;
  const offsets = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const head = Buffer.from(`${index + 1} 0 obj\n${object.dict}\n`, 'latin1');
    chunks.push(head);
    length += head.length;
    if (object.stream) {
      const open = Buffer.from('stream\n', 'latin1');
      const close = Buffer.from('\nendstream\n', 'latin1');
      chunks.push(open, object.stream, close);
      length += open.length + object.stream.length + close.length;
    }
    const tail = Buffer.from('endobj\n', 'latin1');
    chunks.push(tail);
    length += tail.length;
  }

  const xrefAt = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogueObjectId} 0 R >>\n`
    + `startxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));

  void catalogueId;
  void pagesId;
  return Buffer.concat(chunks);
}

/** Can this buffer go into a PDF as-is? Used to route an upload. */
export function isEmbeddableImage(buffer) {
  try {
    describe(buffer, 'x');
    return true;
  } catch {
    return false;
  }
}
