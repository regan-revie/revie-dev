const { TEMPLATES, TEMPLATE_ALIASES, MAROON } = require('./templates');
const { buildSessionEmailModel } = require('../api/nylas/sessionEmailModel');

// Every field the code can put in a model (a rescheduled one has the most).
const modelFields = Object.keys(
  buildSessionEmailModel({
    recipient: 'client',
    sessionName: 's',
    coachName: 'c',
    clientName: 'a',
    start: '2026-11-20T15:00:00Z',
    end: '2026-11-20T16:00:00Z',
    oldStart: '2026-11-19T10:00:00Z',
    oldEnd: '2026-11-19T11:00:00Z',
    coachTimeZone: 'Europe/London',
    meetLink: 'x',
    manageUrl: 'u',
  })
);

const variablesIn = text =>
  Array.from(text.matchAll(/\{\{[#/^]?\s*([A-Za-z]+)\s*\}\}/g)).map(m => m[1]);

describe('Postmark templates', () => {
  it('has one template per email the code sends, under the aliases the code uses', () => {
    expect(Object.values(TEMPLATE_ALIASES).sort()).toEqual([
      'session-reminder-client',
      'session-reminder-coach',
      'session-rescheduled-client',
      'session-rescheduled-coach',
    ]);
    Object.values(TEMPLATE_ALIASES).forEach(alias => expect(TEMPLATES[alias]).toBeDefined());
  });

  it.each(Object.keys(TEMPLATES))('%s only uses variables the model provides', alias => {
    const t = TEMPLATES[alias];
    const used = new Set([
      ...variablesIn(t.subject),
      ...variablesIn(t.html),
      ...variablesIn(t.text),
    ]);
    const unknown = [...used].filter(v => !modelFields.includes(v));
    expect(unknown).toEqual([]);
  });

  it.each(Object.keys(TEMPLATES))(
    '%s has maroon buttons with white text and a plain-text version',
    alias => {
      const t = TEMPLATES[alias];
      expect(t.html).toContain(`background-color:${MAROON}`);
      expect(MAROON).toBe('#310416');
      expect(t.html).toMatch(/color:#ffffff/);
      expect(t.html).not.toMatch(/#ff9352/i);
      expect(t.text.length).toBeGreaterThan(50);
      expect(t.html.match(/\{\{#/g).length).toBe(t.html.match(/\{\{\//g).length);
    }
  );

  it('the client reminder says how to reschedule or cancel and that cancelling inside 48 hours is charged in full', () => {
    const text = TEMPLATES['session-reminder-client'].text;
    expect(text).toMatch(/Reschedule/);
    expect(text).toMatch(/charged in full/);
    expect(text).toMatch(/48 hours/);
  });

  it('reschedule confirmations show the old and the new time', () => {
    ['session-rescheduled-client', 'session-rescheduled-coach'].forEach(alias => {
      expect(TEMPLATES[alias].text).toMatch(/{{oldSessionDate}}/);
      expect(TEMPLATES[alias].text).toMatch(/{{sessionDate}}/);
    });
  });

  it('every one links to the Meet call and to the booking page', () => {
    Object.values(TEMPLATES).forEach(t => {
      expect(t.html).toMatch(/\{\{meetLink\}\}/);
      expect(t.html).toMatch(/\{\{manageUrl\}\}/);
    });
  });
});
