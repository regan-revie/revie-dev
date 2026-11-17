const {
  buildSessionEmailModel,
  formatDate,
  formatTime,
  formatZoneName,
} = require('./sessionEmailModel');

const base = {
  sessionName: 'Find your focus',
  coachName: 'Sam Coach',
  clientName: 'Alex Client',
  manageUrl: 'https://heyrevie.com/order/tx-1',
};

describe('formatting a time in a timezone', () => {
  it("uses the recipient's zone, not UTC: 15:00Z is 3 pm in London in winter, 7 am in Los Angeles", () => {
    const t = new Date('2026-11-20T15:00:00Z');
    expect(formatTime(t, 'Europe/London')).toBe('3:00 pm');
    expect(formatTime(t, 'America/Los_Angeles')).toBe('7:00 am');
    expect(formatDate(t, 'Europe/London')).toBe('Friday 20 November');
  });

  it('can be a different day in another zone', () => {
    const t = new Date('2026-11-20T23:30:00Z');
    expect(formatDate(t, 'Europe/London')).toBe('Friday 20 November');
    expect(formatDate(t, 'Asia/Tokyo')).toBe('Saturday 21 November');
  });

  it('follows daylight saving: the same London wall-clock hour is a different UTC hour in summer', () => {
    const summer = new Date('2026-07-15T14:00:00Z'); // BST
    expect(formatTime(summer, 'Europe/London')).toBe('3:00 pm');
  });

  it('names the zone the way people say it, in winter and summer alike (never "GMT-8" or "Standard")', () => {
    const winter = new Date('2026-11-20T15:00:00Z');
    const summer = new Date('2026-07-15T14:00:00Z');
    expect(formatZoneName(winter, 'America/Los_Angeles')).toBe('Pacific Time');
    expect(formatZoneName(summer, 'America/Los_Angeles')).toBe('Pacific Time');
    expect(formatZoneName(winter, 'America/New_York')).toBe('Eastern Time');
    expect(formatZoneName(winter, 'America/Chicago')).toBe('Central Time');
    expect(formatZoneName(winter, 'Europe/London')).toBe('United Kingdom Time');
  });
});

describe("the coach's email", () => {
  it("shows times in the coach's working-hours timezone, with no note", () => {
    const model = buildSessionEmailModel({
      ...base,
      recipient: 'coach',
      start: '2026-11-20T15:00:00Z',
      end: '2026-11-20T16:00:00Z',
      coachTimeZone: 'America/Los_Angeles',
      clientTimeZone: 'Asia/Tokyo',
      meetLink: 'https://meet.google.com/abc',
    });
    expect(model).toMatchObject({
      recipientName: 'Sam',
      sessionName: 'Find your focus',
      sessionDate: 'Friday 20 November',
      sessionTime: '7:00 am to 8:00 am',
      timeZoneName: 'Pacific Time',
      timeZoneNote: '',
      meetLink: 'https://meet.google.com/abc',
      hasMeetLink: true,
    });
  });
});

describe("the client's email", () => {
  const clientModel = (extra = {}) =>
    buildSessionEmailModel({
      ...base,
      recipient: 'client',
      start: '2026-11-20T15:00:00Z',
      end: '2026-11-20T16:00:00Z',
      coachTimeZone: 'Europe/London',
      ...extra,
    });

  it("shows times in the client's own timezone when we have it, with no note", () => {
    const model = clientModel({ clientTimeZone: 'America/New_York' });
    expect(model.sessionTime).toBe('10:00 am to 11:00 am');
    expect(model.timeZoneNote).toBe('');
    expect(model.recipientName).toBe('Alex');
  });

  it("falls back to the coach's timezone and says so, when we do not have theirs", () => {
    const model = clientModel({ clientTimeZone: undefined });
    expect(model.sessionTime).toBe('3:00 pm to 4:00 pm');
    expect(model.timeZoneNote).toBe(
      "We don't have your timezone, so these times are in Sam Coach's timezone: United Kingdom Time."
    );
  });

  it('treats an unusable timezone as missing rather than trusting it', () => {
    expect(clientModel({ clientTimeZone: 'Mars/Phobos' }).timeZoneNote).toMatch(
      /don't have your timezone/
    );
  });

  it('has no Meet link section when there is no link', () => {
    const model = clientModel({ meetLink: undefined });
    expect(model.hasMeetLink).toBe(false);
    expect(model.meetLink).toBe('');
  });
});

describe('a reschedule confirmation', () => {
  it('carries the old time too, in the same zone as the new one', () => {
    const model = buildSessionEmailModel({
      ...base,
      recipient: 'client',
      start: '2026-11-20T15:00:00Z',
      end: '2026-11-20T16:00:00Z',
      oldStart: '2026-11-19T10:00:00Z',
      oldEnd: '2026-11-19T11:00:00Z',
      coachTimeZone: 'Europe/London',
      clientTimeZone: 'America/New_York',
    });
    expect(model.sessionDate).toBe('Friday 20 November');
    expect(model.oldSessionDate).toBe('Thursday 19 November');
    expect(model.oldSessionTime).toBe('5:00 am to 6:00 am');
  });

  it('has no old-time fields for a reminder', () => {
    const model = buildSessionEmailModel({
      ...base,
      recipient: 'coach',
      start: '2026-11-20T15:00:00Z',
      end: '2026-11-20T16:00:00Z',
      coachTimeZone: 'Europe/London',
    });
    expect(model.oldSessionDate).toBeUndefined();
  });
});

describe('the greeting', () => {
  it('uses the first name only, and a neutral word when there is no name', () => {
    const model = name =>
      buildSessionEmailModel({
        ...base,
        clientName: name,
        recipient: 'client',
        start: '2026-11-20T15:00:00Z',
        end: '2026-11-20T16:00:00Z',
        coachTimeZone: 'Europe/London',
      }).recipientName;
    expect(model('Alex Client')).toBe('Alex');
    expect(model('Alex')).toBe('Alex');
    expect(model('  ')).toBe('there');
    expect(model(undefined)).toBe('there');
  });
});

describe('the booking confirmation fields', () => {
  const NOW = Date.parse('2026-11-17T12:00:00Z');
  const confirmed = (extra = {}) =>
    buildSessionEmailModel({
      ...base,
      recipient: 'client',
      start: '2026-11-25T18:00:00Z',
      end: '2026-11-25T19:00:00Z',
      coachTimeZone: 'Europe/London',
      clientTimeZone: 'America/Los_Angeles',
      now: NOW,
      ...extra,
    });

  it('says how long the session is', () => {
    expect(confirmed().lengthText).toBe('1 hour');
    expect(confirmed({ end: '2026-11-25T18:45:00Z' }).lengthText).toBe('45 minutes');
    expect(confirmed({ end: '2026-11-25T19:30:00Z' }).lengthText).toBe('1 hour 30 minutes');
    expect(confirmed({ end: '2026-11-25T20:00:00Z' }).lengthText).toBe('2 hours');
  });

  it('says what was paid, in the amount and currency it was paid in', () => {
    const model = confirmed({ payinTotal: { amount: 5000, currency: 'USD' } });
    expect(model.totalPaid).toBe('$50.00');
    expect(model.hasTotalPaid).toBe(true);
    expect(confirmed({ payinTotal: { amount: 4500, currency: 'GBP' } }).totalPaid).toBe('£45.00');
    // A zero-decimal currency is not divided by 100.
    expect(confirmed({ payinTotal: { amount: 5000, currency: 'JPY' } }).totalPaid).toBe('¥5,000');
  });

  it('shows no paid line when there is no amount (or it has been refunded to zero)', () => {
    expect(confirmed().hasTotalPaid).toBe(false);
    expect(confirmed({ payinTotal: { amount: 0, currency: 'USD' } }).hasTotalPaid).toBe(false);
    expect(confirmed({ payinTotal: { amount: 5000 } }).totalPaid).toBe('');
  });

  it("says it is free to cancel or move until 48 hours before, in the client's own timezone", () => {
    const model = confirmed();
    // 18:00Z on the 25th is 10:00 in Los Angeles; 48 hours earlier is the 23rd.
    expect(model.freeUntil).toBe('Monday 23 November, 10:00 am (Pacific Time)');
    expect(model.freeWindowOpen).toBe(true);
    expect(model.freeWindowClosed).toBe(false);
  });

  it('says there is no free window when the session is less than 48 hours away', () => {
    const model = confirmed({ start: '2026-11-18T18:00:00Z', end: '2026-11-18T19:00:00Z' });
    expect(model.freeWindowOpen).toBe(false);
    expect(model.freeWindowClosed).toBe(true);
  });

  it('is open right up to the 48-hour mark and closed after it', () => {
    const start = NOW + 48 * 3600000 + 60000; // 48 hours and a minute away
    expect(confirmed({ start, end: start + 3600000 }).freeWindowOpen).toBe(true);
    const later = NOW + 48 * 3600000 - 60000;
    expect(confirmed({ start: later, end: later + 3600000 }).freeWindowOpen).toBe(false);
  });

  it('carries the Outlook link when there is one', () => {
    expect(confirmed({ outlookUrl: 'https://outlook.live.com/x' })).toMatchObject({
      outlookCalendarUrl: 'https://outlook.live.com/x',
      hasOutlookLink: true,
    });
    expect(confirmed().hasOutlookLink).toBe(false);
  });
});
