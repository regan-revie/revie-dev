const {
  buildIcs,
  icsAttachment,
  outlookCalendarUrl,
  icsTime,
  escapeText,
  fold,
} = require('./calendarFile');

const base = {
  uid: 'booking-bk-1@heyrevie.com',
  start: '2026-11-20T19:30:00Z',
  end: '2026-11-20T20:30:00Z',
  summary: 'Find your focus with Sam Coach',
  description:
    'Join: https://meet.google.com/abc-defg-hij\nYour booking: https://revie.example/order/tx-1',
  location: 'https://meet.google.com/abc-defg-hij',
  url: 'https://revie.example/order/tx-1',
  now: '2026-11-17T12:00:00Z',
};
const unfold = ics => ics.replace(/\r\n /g, '');

describe('buildIcs()', () => {
  const ics = buildIcs(base);

  it('is a calendar with one event, ending every line with CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
  });

  it('carries the times in UTC, the title, the Meet link and the booking link', () => {
    const text = unfold(ics);
    expect(text).toContain('DTSTART:20261120T193000Z');
    expect(text).toContain('DTEND:20261120T203000Z');
    expect(text).toContain('SUMMARY:Find your focus with Sam Coach');
    expect(text).toContain('LOCATION:https://meet.google.com/abc-defg-hij');
    expect(text).toContain('URL:https://revie.example/order/tx-1');
    expect(text).toContain(
      'DESCRIPTION:Join: https://meet.google.com/abc-defg-hij\\nYour booking: https://revie.example/order/tx-1'
    );
  });

  it('is a plain published event with the stable id, at sequence 0 by default', () => {
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('UID:booking-bk-1@heyrevie.com');
    expect(ics).toContain('SEQUENCE:0');
    expect(ics).toContain('DTSTAMP:20261117T120000Z');
  });

  it('keeps the same UID and raises the sequence for a moved session, so an app updates the event', () => {
    const moved = buildIcs({
      ...base,
      sequence: 2,
      start: '2026-11-25T10:00:00Z',
      end: '2026-11-25T11:00:00Z',
    });
    expect(moved).toContain('UID:booking-bk-1@heyrevie.com');
    expect(moved).toContain('SEQUENCE:2');
    expect(moved).toContain('DTSTART:20261125T100000Z');
  });

  it('leaves out the location, description and url when there are none (no Meet link)', () => {
    const bare = buildIcs({ ...base, location: '', description: '', url: '' });
    expect(bare).not.toMatch(/LOCATION|DESCRIPTION|URL:/);
  });

  it('folds long lines at 75 octets and never splits a character', () => {
    const long = buildIcs({ ...base, summary: `Séance ${'é'.repeat(80)}` });
    long
      .split('\r\n')
      .forEach(line => expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75));
    expect(unfold(long)).toContain(`SUMMARY:Séance ${'é'.repeat(80)}`);
  });
});

describe('text helpers', () => {
  it('escapes backslashes, semicolons, commas and line breaks', () => {
    expect(escapeText('a, b; c\\d\ne')).toBe('a\\, b; c\\\\d\\ne');
  });

  it('writes times as basic UTC', () => {
    expect(icsTime('2026-11-20T19:30:00.123Z')).toBe('20261120T193000Z');
  });

  it('folds nothing that is short', () => {
    expect(fold('SUMMARY:Short')).toBe('SUMMARY:Short');
  });
});

describe('icsAttachment()', () => {
  it('is base64 of the file, named, as a calendar type', () => {
    const attachment = icsAttachment('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    expect(attachment.name).toBe('revie-session.ics');
    expect(attachment.contentType).toMatch(/^text\/calendar/);
    expect(Buffer.from(attachment.content, 'base64').toString('utf8')).toBe(
      'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'
    );
  });
});
