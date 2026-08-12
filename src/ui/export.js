// Getting music back out again.
//
// Everything in this app stays on the phone, which is the whole point of it —
// and a thing you can never get out of an app is a thing the app owns rather
// than you. So: a score, with every mark you have made on it, as an ordinary
// PDF that any other program can open, printed by the phone, mailed to a
// teacher, or dropped into forScore itself.
//
// The PDF is written by hand, in about eighty lines, because the alternative is
// half a megabyte of library to draw pictures into a box. A page of a scanned
// score is already a photograph; a photograph with ink drawn over it is still a
// photograph; and a PDF whose pages are photographs is the simplest file in the
// format. Nothing here compresses, transforms or re-encodes anything: the JPEG
// the canvas produces goes into the file as it is.

const encoder = new TextEncoder();

// A JPEG, and the box it goes in. `bytes` is the file, exactly as encoded.
export function pdfFromPages(pages) {
  const chunks = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
    return length;
  };
  const offsets = [0];
  const object = (number, body, stream = null) => {
    offsets[number] = length;
    push(`${number} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  push('%PDF-1.4\n');
  // Binary comment, so anything transferring the file treats it as binary.
  push(new Uint8Array([0x25, 0xc3, 0xa4, 0xc3, 0xbc, 0x0a]));

  // 1 catalogue, 2 page list, then three objects a page.
  const first = 3;
  const kids = pages.map((_, i) => `${first + i * 3} 0 R`).join(' ');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  for (const [i, page] of pages.entries()) {
    const self = first + i * 3;
    const image = self + 1;
    const contents = self + 2;
    // 72 points to the inch; a page is sized so the picture lands at 150dpi,
    // which is a sheet of music you can read and print.
    const w = Math.round((page.width / 150) * 72);
    const h = Math.round((page.height / 150) * 72);
    object(self, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] `
      + `/Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${contents} 0 R >>`);
    object(image, `<< /Type /XObject /Subtype /Image /Width ${page.width} `
      + `/Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 `
      + `/Filter /DCTDecode /Length ${page.bytes.length} >>`, page.bytes);
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(contents, `<< /Length ${draw.length} >>`, draw);
  }

  const count = first + pages.length * 3;
  const startxref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    table += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return new Blob([out], { type: 'application/pdf' });
}

// Out of the app and into whatever the phone can do with it: mail, Files,
// AirDrop, another music reader, the printer. The share sheet is asked first
// because on a phone that is what "give me this file" means; a download is the
// fallback, and on a desktop it is the whole answer.
export async function shareFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      // Cancelling the share sheet is not a failure and must not look like one.
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}

// A name a file system will accept and a person will recognise.
export function fileName(name, extension) {
  const clean = String(name ?? 'score').replace(/[^\w \-()'.]+/g, ' ').trim().slice(0, 60);
  return `${clean || 'score'}.${extension}`;
}
