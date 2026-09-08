// THE STORAGE LINE HAS TO NAME A UNIT SOMEBODY USES.
//
// "3 takes, 1 KB of audio of about 10240 MB available." — the helper stopped at
// MB, so every real device quota (headless Chrome hands back 10737425458 bytes;
// a phone hands back more) was printed as a five-figure number of megabytes.
// These are the sizes both ends of that sentence actually take.
import { describe, it, expect } from 'vitest';
import { describeBytes } from '../src/ui/settings.js';

const KIB = 1024;
const MIB = 1048576;
const GIB = 1073741824;

describe('describeBytes', () => {
  it('names a device quota in gigabytes', () => {
    // The number headless Chrome handed back when this was measured.
    expect(describeBytes(10737425458)).toBe('10 GB');
    expect(describeBytes(64 * GIB)).toBe('64 GB');
    expect(describeBytes(1.4 * GIB)).toBe('1.4 GB');
    expect(describeBytes(GIB)).toBe('1.0 GB');
  });

  it('never prints four figures in front of a unit', () => {
    // Every threshold, from either side. A sweep cannot see these: the window
    // that used to print "1010 MB" is 24 MiB wide.
    const edges = [
      999.4 * KIB, 999.6 * KIB, MIB,
      9.94 * MIB, 9.96 * MIB,
      999.4 * MIB, 999.6 * MIB, 1010 * MIB, 1023.9 * MIB, GIB,
      9.94 * GIB, 9.96 * GIB, 10737425458, 512 * GIB,
    ];
    for (const b of edges) expect(describeBytes(b)).not.toMatch(/\d{4}/);
  });

  it('switches unit on what would print, not at the binary boundary', () => {
    // 1010 MiB is under a gigabyte, but "1010 MB" is the four-figure fault this
    // whole helper exists to avoid.
    expect(describeBytes(1010 * MIB)).toBe('1.0 GB');
    expect(describeBytes(1023.9 * MIB)).toBe('1.0 GB');
    expect(describeBytes(999.4 * MIB)).toBe('999 MB');
    expect(describeBytes(999.4 * KIB)).toBe('999 KB');
    expect(describeBytes(999.6 * KIB)).toBe('1.0 MB');
  });

  it('keeps a take-sized library in kilobytes and megabytes', () => {
    expect(describeBytes(2 * KIB)).toBe('2 KB');
    expect(describeBytes(MIB)).toBe('1.0 MB');
    expect(describeBytes(4.2 * MIB)).toBe('4.2 MB');
    expect(describeBytes(48 * MIB)).toBe('48 MB');
  });

  it('rounds a saved take up to a kilobyte rather than calling it nothing', () => {
    expect(describeBytes(12)).toBe('1 KB');
    expect(describeBytes(0)).toBe('1 KB');
  });
});
