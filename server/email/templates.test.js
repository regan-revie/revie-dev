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
      'booking-confirmed-client',
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

  it("the client reminder says the session can't be moved (it is inside 48 hours) and that cancelling is charged in full, and suggests nothing else", () => {
    const { text, html } = TEMPLATES['session-reminder-client'];
    [text, html].forEach(body => {
      expect(body).toMatch(/less than 48 hours away, so it can't be moved/);
      expect(body).toMatch(/charged in full/);
      // Reschedule is not available at this point, and nobody is told to message the coach.
      expect(body).not.toMatch(/choose Reschedule/);
      expect(body).not.toMatch(/message (your|the) coach|message \{\{coachName\}\}/i);
    });
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

  describe('the client\'s "You\'re booked" email', () => {
    const t = TEMPLATES['booking-confirmed-client'];

    it('says it, with the session, the coach and the length', () => {
      expect(t.subject).toBe("You're booked: {{sessionName}} with {{coachName}}");
      [t.html, t.text].forEach(body => {
        expect(body).toMatch(/You're booked/);
        expect(body).toMatch(/\{\{coachName\}\}/);
        expect(body).toMatch(/\{\{lengthText\}\}/);
        expect(body).toMatch(/\{\{timeZoneName\}\}/);
      });
    });

    it('has Join on Google Meet, Add to Outlook and See your booking, as buttons, in maroon', () => {
      expect(t.html).toContain('Join on Google Meet');
      expect(t.html).toContain('Add to Outlook');
      expect(t.html).toContain('See your booking');
      expect(t.html).toMatch(/\{\{outlookCalendarUrl\}\}/);
      expect(t.html).toContain(`background-color:${MAROON}`);
    });

    it('has no "Add to Google Calendar": it says the session is already there, and points the rest at the attached file', () => {
      [t.html, t.text].forEach(body => {
        expect(body).not.toMatch(/Add to Google Calendar/i);
        expect(body).toContain("Using Google Calendar? It's already there.");
        expect(body).toMatch(/attached calendar file/);
      });
    });

    it('says what was paid, only when there is an amount', () => {
      expect(t.html).toMatch(
        /\{\{#hasTotalPaid\}\}[\s\S]*Total paid: \{\{totalPaid\}\}[\s\S]*\{\{\/hasTotalPaid\}\}/
      );
      expect(t.text).toMatch(/Total paid: \{\{totalPaid\}\}/);
    });

    it('states the refund rule in one line, and a different line when there is no free window', () => {
      [t.html, t.text].forEach(body => {
        expect(body).toContain(
          "Free to cancel or move until {{freeUntil}}. After that, it's charged in full."
        );
        expect(body).toContain(
          "This session is less than 48 hours away, so it can't be moved. If you cancel now, you'll be charged in full."
        );
        expect(body).toMatch(/\{\{#freeWindowOpen\}\}/);
        expect(body).toMatch(/\{\{#freeWindowClosed\}\}/);
      });
    });
  });

  it('the client reschedule email says when it is free to cancel or move until, and points at the updated calendar file', () => {
    const t = TEMPLATES['session-rescheduled-client'];
    [t.html, t.text].forEach(body => {
      expect(body).toMatch(/\{\{freeUntil\}\}/);
      expect(body).toMatch(/attached calendar file/);
    });
  });

  it("the coach's emails say nothing about the client's calendar file or refund rule", () => {
    ['session-reminder-coach', 'session-rescheduled-coach'].forEach(alias => {
      expect(TEMPLATES[alias].text).not.toMatch(/calendar file|charged in full/);
    });
  });
});
