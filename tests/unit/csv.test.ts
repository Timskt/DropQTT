import { describe, expect, it } from 'vitest';
import { csvCell, csvRow } from '../../src/utils/csv';

describe('csvCell', () => {
  it('neutralises spreadsheet formula triggers', () => {
    // Topic names and payloads are attacker-controlled: anyone who can publish
    // can name a topic that Excel would execute.
    expect(csvCell('=cmd|\'/c calc\'!A1')).toBe("'=cmd|'/c calc'!A1");
    expect(csvCell('+1 (555) 123-4567')).toBe("'+1 (555) 123-4567");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\t=1')).toBe("'\t=1");
  });

  it('leaves ordinary text alone unless it needs quoting', () => {
    expect(csvCell('sensor/temp')).toBe('sensor/temp');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('quotes and escapes a cell that is both a trigger and needs quoting', () => {
    // The apostrophe does not exempt the cell from CSV quoting rules.
    expect(csvCell('=a,b')).toBe('"\'=a,b"');
    expect(csvCell('=x"y')).toBe('"\'=x""y"');
  });

  it('does not quote or prefix numbers and booleans', () => {
    expect(csvCell(0)).toBe('0');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('builds a row where only string cells are neutralised', () => {
    expect(csvRow(['=evil', 2, true, 'a,b'])).toBe("'=evil,2,true,\"a,b\"");
  });
});
