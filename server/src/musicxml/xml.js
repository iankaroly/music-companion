// A small, dependency-free XML reader.
//
// WHY NOT A LIBRARY: MusicXML is a closed, well-specified vocabulary. We need
// elements, attributes and text — no namespaces to resolve, no schema
// validation, no XPath. A 150-line reader with no transitive dependencies is
// less attack surface than a general parser, and it lets us keep source order,
// which MusicXML depends on completely: <backup>, <forward> and <note> mean
// nothing except in the order they were written.
//
// It is deliberately lenient about things a scanner's OMR export gets wrong
// (stray whitespace, a missing declaration, a DOCTYPE pointing at a DTD we will
// never fetch) and strict about things that would silently corrupt a score
// (mismatched tags).

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decodeEntities(text) {
  if (!text.includes('&')) return text; // the common case, no allocation
  return text.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole; // unknown entity: leave it visible rather than eat it
  });
}

/**
 * One element of the document.
 *
 * The accessors (`child`, `all`, `textOf`, `numberOf`) exist because almost
 * every read of MusicXML is "give me this child's text, or a default" and
 * writing that by hand at 200 call sites is where parsing bugs live.
 */
export class XmlNode {
  constructor(name, attrs = {}) {
    this.name = name;
    this.attrs = attrs;
    /** @type {XmlNode[]} */
    this.children = [];
    this.text = '';
  }

  /** First direct child with this tag name, or null. */
  child(name) {
    for (const c of this.children) if (c.name === name) return c;
    return null;
  }

  /** Every direct child with this tag name, in document order. */
  all(name) {
    return this.children.filter((c) => c.name === name);
  }

  /** Text of a direct child, trimmed; `fallback` when the child is absent. */
  textOf(name, fallback = null) {
    const c = this.child(name);
    if (!c) return fallback;
    const t = c.text.trim();
    return t === '' ? fallback : t;
  }

  /** Numeric text of a direct child; `fallback` when absent or not a number. */
  numberOf(name, fallback = null) {
    const t = this.textOf(name);
    if (t === null) return fallback;
    const n = Number(t);
    return Number.isFinite(n) ? n : fallback;
  }

  /** Numeric attribute; `fallback` when absent or not a number. */
  attrNumber(name, fallback = null) {
    const v = this.attrs[name];
    if (v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /** Depth-first walk over this node and everything under it. */
  *walk() {
    yield this;
    for (const c of this.children) yield* c.walk();
  }
}

/**
 * Parse an XML document into an {@link XmlNode} tree.
 * @param {string} source
 * @returns {XmlNode} the root element
 */
export function parseXml(source) {
  let at = 0;
  const stack = [];
  let root = null;

  const fail = (message) => {
    // Report a line number: OMR exports are machine-written and a human
    // debugging one needs to be pointed at the byte, not handed "invalid XML".
    const line = source.slice(0, at).split('\n').length;
    throw new SyntaxError(`${message} (line ${line})`);
  };

  const skipTo = (marker) => {
    const end = source.indexOf(marker, at);
    at = end === -1 ? source.length : end + marker.length;
  };

  while (at < source.length) {
    const lt = source.indexOf('<', at);

    if (lt === -1) break; // trailing whitespace after the root element

    if (lt > at) {
      // Character data between tags. Only kept when something is open —
      // whitespace outside the root is not text, it is formatting.
      const top = stack[stack.length - 1];
      if (top) top.text += decodeEntities(source.slice(at, lt));
    }
    at = lt;

    if (source.startsWith('<!--', at)) { skipTo('-->'); continue; }
    if (source.startsWith('<?', at)) { skipTo('?>'); continue; }        // <?xml ...?>
    if (source.startsWith('<![CDATA[', at)) {
      const end = source.indexOf(']]>', at);
      if (end === -1) fail('unterminated CDATA section');
      const top = stack[stack.length - 1];
      if (top) top.text += source.slice(at + 9, end);
      at = end + 3;
      continue;
    }
    if (source.startsWith('<!', at)) {
      // DOCTYPE. It may carry an internal subset in [ ... ]; step over both.
      const bracket = source.indexOf('[', at);
      const close = source.indexOf('>', at);
      if (bracket !== -1 && close !== -1 && bracket < close) { skipTo(']'); skipTo('>'); }
      else skipTo('>');
      continue;
    }

    if (source[at + 1] === '/') {
      // Closing tag.
      at += 2;
      NAME.lastIndex = at;
      const m = NAME.exec(source);
      if (!m) fail('expected a name after </');
      at = NAME.lastIndex;
      const close = source.indexOf('>', at);
      if (close === -1) fail('unterminated closing tag');
      at = close + 1;
      const open = stack.pop();
      if (!open) fail(`closing tag </${m[0]}> with nothing open`);
      if (open.name !== m[0]) fail(`closing tag </${m[0]}> does not match <${open.name}>`);
      continue;
    }

    // Opening tag.
    at += 1;
    NAME.lastIndex = at;
    const nameMatch = NAME.exec(source);
    if (!nameMatch) fail('expected an element name after <');
    at = NAME.lastIndex;

    const node = new XmlNode(nameMatch[0]);

    // Attributes, until we hit `>` or `/>`.
    for (;;) {
      while (at < source.length && /\s/.test(source[at])) at += 1;
      if (source[at] === '>') { at += 1; break; }
      if (source.startsWith('/>', at)) {
        at += 2;
        attach(node);
        node.selfClosed = true;
        break;
      }
      if (at >= source.length) fail('unterminated opening tag');

      NAME.lastIndex = at;
      const attrName = NAME.exec(source);
      if (!attrName) fail(`unexpected character '${source[at]}' in tag <${node.name}>`);
      at = NAME.lastIndex;
      while (at < source.length && /\s/.test(source[at])) at += 1;
      if (source[at] !== '=') { node.attrs[attrName[0]] = ''; continue; } // bare attribute
      at += 1;
      while (at < source.length && /\s/.test(source[at])) at += 1;
      const quote = source[at];
      if (quote !== '"' && quote !== "'") fail(`unquoted value for ${attrName[0]}`);
      const end = source.indexOf(quote, at + 1);
      if (end === -1) fail(`unterminated value for ${attrName[0]}`);
      node.attrs[attrName[0]] = decodeEntities(source.slice(at + 1, end));
      at = end + 1;
    }

    if (!node.selfClosed) { attach(node); stack.push(node); }
  }

  if (stack.length) fail(`<${stack[stack.length - 1].name}> was never closed`);
  if (!root) throw new SyntaxError('no root element — this is not an XML document');
  return root;

  function attach(node) {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (!root) root = node;
    // A second root-level element is malformed XML; ignore it rather than throw,
    // because some exporters append a comment-like trailer.
  }
}
