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
    expect(formatZoneName(summer, 'Europe/London')).toBe('BST');
    expect(formatZoneName(new Date('2026-11-20T15:00:00Z'), 'Europe/London')).toBe('GMT');
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
      timeZoneName: 'GMT-8',
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
      "We don't have your timezone, so these times are in Sam Coach's timezone: London time (GMT)."
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
