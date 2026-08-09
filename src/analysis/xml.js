// A small XML reader, enough for MusicXML and nothing more.
//
// The browser has DOMParser; Node does not, and this project carries no runtime
// dependencies. MusicXML is machine-generated and structurally plain — elements,
// attributes, text, the five predefined entities — so reading it by hand costs
// about a hundred lines and makes the parser above it testable in plain Node,
// which is where every other analysis module is already tested.
//
// Deliberately NOT supported, because MusicXML does not need them: namespaces
// as anything other than part of a tag name, processing instructions beyond the
// declaration, custom entities from the DTD, mixed content (an element holds
// either text or children — MusicXML never interleaves them).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(raw) {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

class Node {
  constructor(name, attrs) {
    this.name = name;
    this.attrs = attrs;
    this.children = [];
    this.text = '';
  }

  // First child of that name, or undefined. Named for how it reads at the call
  // site: node.child('duration').text.
  child(name) {
    return this.children.find((c) => c.name === name);
  }

  all(name) {
    return this.children.filter((c) => c.name === name);
  }

  // Text of a named child, or a fallback — the shape almost every MusicXML
  // read actually wants.
  textOf(name, fallback = '') {
    const found = this.child(name);
    return found ? found.text : fallback;
  }

  numberOf(name, fallback = null) {
    const found = this.child(name);
    if (!found) return fallback;
    const value = Number(found.text);
    return Number.isFinite(value) ? value : fallback;
  }
}

function parseAttrs(source) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(source))) {
    attrs[m[1]] = decode(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function parseXml(source) {
  let i = 0;
  const stack = [];
  let root = null;

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;

    // Text belongs to whatever element is currently open. Whitespace between
    // tags is layout, not content, so it is trimmed away.
    if (stack.length && lt > i) {
      const chunk = source.slice(i, lt).trim();
      if (chunk) stack[stack.length - 1].text += decode(chunk);
    }

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      if (end === -1) throw new Error('unterminated comment');
      i = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt);
      if (end === -1) throw new Error('unterminated CDATA');
      if (stack.length) stack[stack.length - 1].text += source.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    // <?xml ...?> and <!DOCTYPE ...>. A doctype may carry a bracketed internal
    // subset, so scan past that before looking for its '>'.
    if (source.startsWith('<?', lt) || source.startsWith('<!', lt)) {
      let scan = lt;
      if (source.startsWith('<!DOCTYPE', lt)) {
        const bracket = source.indexOf('[', lt);
        const close = source.indexOf('>', lt);
        if (bracket !== -1 && close !== -1 && bracket < close) {
          const endSubset = source.indexOf(']', bracket);
          if (endSubset === -1) throw new Error('unterminated doctype');
          scan = endSubset;
        }
      }
      const end = source.indexOf('>', scan);
      if (end === -1) throw new Error('unterminated declaration');
      i = end + 1;
      continue;
    }

    const gt = source.indexOf('>', lt);
    if (gt === -1) throw new Error('unterminated tag');

    // Closing tag.
    if (source[lt + 1] === '/') {
      const name = source.slice(lt + 2, gt).trim();
      const open = stack.pop();
      if (!open) throw new Error(`unexpected closing tag: ${name}`);
      if (open.name !== name) throw new Error(`unclosed tag: ${open.name}`);
      i = gt + 1;
      continue;
    }

    const selfClosing = source[gt - 1] === '/';
    const inner = source.slice(lt + 1, selfClosing ? gt - 1 : gt);
    const space = inner.search(/\s/);
    const name = space === -1 ? inner : inner.slice(0, space);
    const attrs = space === -1 ? {} : parseAttrs(inner.slice(space));
    const node = new Node(name, attrs);

    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (!root) root = node;

    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }

  if (stack.length) throw new Error(`unclosed tag: ${stack[stack.length - 1].name}`);
  if (!root) throw new Error('no root element');
  return root;
}
