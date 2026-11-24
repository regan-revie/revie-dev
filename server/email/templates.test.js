const { TEMPLATES, TEMPLATE_ALIASES, MAROON } = require('./templates');
const { buildSessionEmailModel } = require('../api/nylas/sessionEmailModel');
const {
  buildReconnectEmailModel,
  CALENDAR_RECONNECT_ALIAS,
} = require('../api/nylas/reconnectEmailModel');

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

// The reconnect email has its own small model, not a session's.
const modelFieldsFor = alias =>
  alias === CALENDAR_RECONNECT_ALIAS
    ? Object.keys(buildReconnectEmailModel({ coachName: 'Sam', siteUrl: 'https://heyrevie.com' }))
    : modelFields;

// The session emails (all but the reconnect email, which is about a connection, not a session).
// Emails about a session that carry no Meet link: the 60-hour reminder is a date and one button, and
// the declined-invite note says it is still booked and where to cancel.
const NO_MEET_LINK = ['session-reminder-60h-client', 'calendar-invite-declined-client'];

const SESSION_TEMPLATES = Object.entries(TEMPLATES).filter(
  ([alias]) => alias !== CALENDAR_RECONNECT_ALIAS
);

const variablesIn = text =>
  Array.from(text.matchAll(/\{\{[#/^]?\s*([A-Za-z]+)\s*\}\}/g)).map(m => m[1]);

describe('the "your session is still booked" email (the client declined the calendar invite)', () => {
  const t = TEMPLATES['calendar-invite-declined-client'];
  const render = (body, model) =>
    body
      .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (all, name, inner) =>
        model[name] ? inner.replace(/\{\{\.\}\}/g, model[name]) : ''
      )
      .replace(/\{\{(\w+)\}\}/g, (all, name) => (name in model ? model[name] : all));
  const model = buildSessionEmailModel({
    recipient: 'client',
    sessionName: 'Find your focus',
    coachName: 'Sam Coach',
    clientName: 'Alex Client',
    start: '2026-12-10T17:00:00Z',
    end: '2026-12-10T18:00:00Z',
    coachTimeZone: 'Europe/London',
    clientTimeZone: 'America/Los_Angeles',
    manageUrl: 'https://heyrevie.com/order/tx-1',
  });

  it('is under the alias the code sends, with the agreed subject', () => {
    expect(TEMPLATE_ALIASES['declined-invite-client']).toBe('calendar-invite-declined-client');
    expect(t.subject).toBe('Your session is still booked');
  });

  it('says what they did, that it is still booked, and where to cancel: the session, the coach and the time in their zone', () => {
    [t.html, t.text].forEach(body => {
      const out = render(body, model);
      expect(out).toContain(
        `You declined the calendar invite for Find your focus with Sam Coach on ${model.sessionDate}, ${model.sessionTime} (Pacific Time).`
      );
      expect(out).toContain('Your session is still booked. To cancel, use Revie.');
      expect(out).toContain('Cancelling within 48 hours of the session is charged in full.');
    });
  });

  it('has one button, See your booking, in maroon, to the booking page', () => {
    expect(t.html.match(/<a href=/g)).toHaveLength(1);
    expect(t.html).toContain('See your booking');
    expect(t.html).toContain('href="{{manageUrl}}"');
    expect(t.html).toContain(`background-color:${MAROON}`);
    expect(t.text).toContain('See your booking: {{manageUrl}}');
  });

  it('does not suggest messaging or contacting the coach', () => {
    [t.html, t.text, t.subject].forEach(body => {
      expect(body).not.toMatch(/message|write to (your )?coach|contact (your )?coach/i);
    });
  });

  it('prints no blank when there is no timezone note', () => {
    const out = render(t.text, { ...model, timeZoneNote: '' });
    expect(out).not.toMatch(/\{\{/);
  });
});

describe('the reconnect-your-calendar email', () => {
  const t = TEMPLATES[CALENDAR_RECONNECT_ALIAS];

  it('exists under the alias the code sends', () => {
    expect(CALENDAR_RECONNECT_ALIAS).toBe('calendar-reconnect-coach');
    expect(t).toBeDefined();
  });

  it('has the agreed subject and one "Reconnect calendar" button to the link', () => {
    expect(t.subject).toBe('Reconnect your calendar to keep taking bookings');
    expect(t.html).toContain('>Reconnect calendar</a>');
    expect(t.html.match(/<a /g)).toHaveLength(1);
    expect(t.html).toContain('href="{{reconnectUrl}}"');
    expect(t.text).toContain('Reconnect calendar: {{reconnectUrl}}');
  });

  it('says the connection stopped working, that clients cannot book until she reconnects, and that booked sessions are safe', () => {
    [t.html, t.text].forEach(body => {
      expect(body).toContain('Your Google Calendar connection stopped working.');
      expect(body).toMatch(/clients can't book you/);
      expect(body).toMatch(/already booked aren't affected/);
    });
  });
});

describe('Postmark templates', () => {
  it('has one template per email the code sends, under the aliases the code uses', () => {
    expect(Object.values(TEMPLATE_ALIASES).sort()).toEqual([
      'booking-confirmed-client',
      'calendar-invite-declined-client',
      'session-reminder-60h-client',
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
    const unknown = [...used].filter(v => !modelFieldsFor(alias).includes(v));
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
      expect((t.html.match(/\{\{#/g) || []).length).toBe((t.html.match(/\{\{\//g) || []).length);
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

  it('every one links to the booking page, and (but for the 60-hour reminder, which is a date and a button) to the Meet call', () => {
    SESSION_TEMPLATES.forEach(([alias, t]) => {
      expect(t.html).toMatch(/\{\{manageUrl\}\}/);
      if (!NO_MEET_LINK.includes(alias)) expect(t.html).toMatch(/\{\{#meetLink\}\}/);
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

    it('has Join on Google Meet, Add to calendar and See your booking, as buttons, in maroon', () => {
      expect(t.html).toContain('Join on Google Meet');
      expect(t.html).toContain('Add to calendar');
      expect(t.html).not.toContain('Add to Outlook');
      expect(t.html).toContain('See your booking');
      expect(t.html).toMatch(/\{\{#calendarUrl\}\}/);
      expect(t.html).toContain(`background-color:${MAROON}`);
    });

    it('has no "Add to Google Calendar": it says the session is already there, and points the rest at the attached file', () => {
      [t.html, t.text].forEach(body => {
        expect(body).not.toMatch(/Add to Google Calendar/i);
        expect(body).toContain("Using Google Calendar? It's already there.");
        expect(body).toContain('Apple Calendar or Outlook? Tap Add to calendar.');
      });
    });

    it('says what was paid, only when there is an amount', () => {
      expect(t.html).toMatch(
        /\{\{#totalPaid\}\}[\s\S]*Total paid: \{\{\.\}\}[\s\S]*\{\{\/totalPaid\}\}/
      );
      expect(t.text).toMatch(/\{\{#totalPaid\}\}[\s\S]*Total paid: \{\{\.\}\}/);
    });

    it('shows the full price and the promo discount only when there is one, each as a whole text', () => {
      expect(t.html).toMatch(
        /\{\{#fullPriceText\}\}[\s\S]*\{\{\.\}\}[\s\S]*\{\{\/fullPriceText\}\}/
      );
      expect(t.html).toMatch(/\{\{#discountText\}\}[\s\S]*\{\{\.\}\}[\s\S]*\{\{\/discountText\}\}/);
      expect(t.text).toMatch(/\{\{#discountText\}\}\s*\{\{\.\}\}\s*\{\{\/discountText\}\}/);
      // Before the total, so it reads price, discount, total.
      expect(t.html.indexOf('{{#discountText}}')).toBeLessThan(t.html.indexOf('{{#totalPaid}}'));
    });

    it('states the refund rule in one line, and a different line when there is no free window', () => {
      [t.html, t.text].forEach(body => {
        expect(body).toContain(
          "Free to cancel or move until {{.}}. After that, it's charged in full."
        );
        expect(body).toContain(
          "This session is less than 48 hours away, so it can't be moved. If you cancel now, you'll be charged in full."
        );
        expect(body).toMatch(/\{\{#freeUntilOpen\}\}/);
        expect(body).toMatch(/\{\{#freeWindowClosed\}\}/);
      });
    });
  });

  it('the client reschedule email says when it is free to cancel or move until, and points at the updated calendar file', () => {
    const t = TEMPLATES['session-rescheduled-client'];
    [t.html, t.text].forEach(body => {
      expect(body).toMatch(/\{\{#freeUntilOpen\}\}/);
      expect(body).toMatch(/attached calendar file/);
    });
  });

  it("the coach's emails say nothing about the client's calendar file or refund rule", () => {
    ['session-reminder-coach', 'session-rescheduled-coach'].forEach(alias => {
      expect(TEMPLATES[alias].text).not.toMatch(/calendar file|charged in full/);
    });
  });

  describe("Postmark's scoping: nothing prints blank", () => {
    // A small stand-in for Postmark's template engine (Mustachio) with the one rule that matters:
    // inside {{#name}}...{{/name}} a variable is looked up in the section's own value, not in the
    // model it came from, and {{.}} is the value itself. This is the rule that left "Total paid:"
    // and "Free to cancel or move until ." empty in a real email.
    const lookup = (scope, name) =>
      scope !== null && typeof scope === 'object' ? scope[name] : undefined;
    const SECTION = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/;
    const render = (template, scope) => {
      let out = template;
      let match = SECTION.exec(out);
      while (match) {
        const value = lookup(scope, match[1]);
        const shown = value !== undefined && value !== null && value !== false && value !== '';
        // eslint-disable-next-line no-loop-func
        out = out.replace(match[0], shown ? render(match[2], value === true ? true : value) : '');
        match = SECTION.exec(out);
      }
      return out
        .replace(
          /\{\{\{\s*\.\s*\}\}\}|\{\{\s*\.\s*\}\}/g,
          typeof scope === 'object' ? '' : String(scope)
        )
        .replace(/\{\{\{?\s*(\w+)\s*\}?\}\}/g, (_, name) => {
          const value = lookup(scope, name);
          return value === undefined || value === null ? '' : String(value);
        });
    };

    const model = buildSessionEmailModel({
      recipient: 'client',
      sessionName: 'Find your focus',
      coachName: 'Sam Coach',
      clientName: 'Alex Client',
      start: Date.now() + 72 * 3600000,
      end: Date.now() + 73 * 3600000,
      coachTimeZone: 'Europe/London',
      clientTimeZone: 'America/Los_Angeles',
      meetLink: 'https://meet.google.com/abc-defg-hij',
      manageUrl: 'https://heyrevie.com/order/x',
      payinTotal: { amount: 5000, currency: 'USD' },
      calendarUrl: 'https://heyrevie.com/api/nylas/calendar/tok_123/revie-session.ics',
    });

    it('the booked email shows what was paid, the free-until time, the Meet link and the Add to calendar link', () => {
      const t = TEMPLATES['booking-confirmed-client'];
      [t.html, t.text].forEach(body => {
        const out = render(body, model);
        expect(out).toContain('Total paid: $50.00');
        expect(out).toMatch(
          /Free to cancel or move until \w+ \d+ \w+, [\d:]+ [ap]m \(Pacific Time\)\. After that/
        );
        expect(out).toContain('https://meet.google.com/abc-defg-hij');
        expect(out).toContain('https://heyrevie.com/api/nylas/calendar/tok_123/revie-session.ics');
        expect(out).not.toMatch(/Total paid: *(<|\n)|until \./);
      });
    });

    it("the same engine would have printed the old template's two lines blank (so this test can fail)", () => {
      const old = '{{#hasTotalPaid}}Total paid: {{totalPaid}}{{/hasTotalPaid}}';
      expect(render(old, model)).toBe('Total paid: ');
    });

    it('a booking with no amount shows no paid line at all, and one made inside 48 hours shows the locked line instead', () => {
      const t = TEMPLATES['booking-confirmed-client'];
      const noAmount = { ...model, totalPaid: '', hasTotalPaid: false };
      expect(render(t.text, noAmount)).not.toMatch(/Total paid/);

      const soon = buildSessionEmailModel({
        recipient: 'client',
        sessionName: 'S',
        coachName: 'C',
        clientName: 'A',
        start: Date.now() + 30 * 3600000,
        end: Date.now() + 31 * 3600000,
        coachTimeZone: 'Europe/London',
        clientTimeZone: 'America/Los_Angeles',
        manageUrl: 'u',
      });
      const out = render(t.text, soon);
      expect(out).toContain("This session is less than 48 hours away, so it can't be moved.");
      expect(out).not.toMatch(/Free to cancel or move until/);
    });

    it('every template prints every value it has (reminders and reschedules too)', () => {
      const withMove = buildSessionEmailModel({
        recipient: 'client',
        sessionName: 'Find your focus',
        coachName: 'Sam Coach',
        clientName: 'Alex Client',
        start: Date.now() + 72 * 3600000,
        end: Date.now() + 73 * 3600000,
        oldStart: Date.now() + 50 * 3600000,
        oldEnd: Date.now() + 51 * 3600000,
        coachTimeZone: 'Europe/London',
        clientTimeZone: 'America/Los_Angeles',
        meetLink: 'https://meet.google.com/abc-defg-hij',
        manageUrl: 'https://heyrevie.com/order/x',
      });
      SESSION_TEMPLATES.forEach(([alias, t]) => {
        const out = render(t.html, withMove) + render(t.text, withMove);
        expect(out).toContain('https://heyrevie.com/order/x'); // the booking link
        expect(out).toContain(withMove.sessionDate);
        // The 60-hour reminder is a date and one button: no Meet link by design.
        if (!NO_MEET_LINK.includes(alias)) {
          expect(out).toContain('https://meet.google.com/abc-defg-hij');
        }
      });
    });

    describe('the 60-hour reminder', () => {
      const t = TEMPLATES['session-reminder-60h-client'];
      const reminderModel = buildSessionEmailModel({
        recipient: 'client',
        sessionName: 'Find your focus',
        coachName: 'Sam Coach',
        clientName: 'Alex Client',
        start: Date.now() + 60 * 3600000,
        end: Date.now() + 61 * 3600000,
        coachTimeZone: 'Europe/London',
        clientTimeZone: 'America/Los_Angeles',
        manageUrl: 'https://heyrevie.com/order/x',
      });

      it("says when the session is, in the client's zone, and when it is free to cancel or move until, with the zone name", () => {
        [t.html, t.text].forEach(body => {
          const out = render(body, reminderModel);
          expect(out).toContain('Your session with Sam Coach is on ');
          expect(out).toContain(
            `${reminderModel.sessionDate}, ${reminderModel.sessionTime} (Pacific Time).`
          );
          expect(out).toMatch(
            /Free to cancel or move until \w+ \d+ \w+, [\d:]+ [ap]m \(Pacific Time\)\. After that, it's charged in full\./
          );
          expect(out).not.toMatch(/until \./);
        });
      });

      it('has one button, See your booking, in maroon, and does not suggest messaging the coach', () => {
        expect(t.html.match(/<a href=/g)).toHaveLength(1);
        expect(t.html).toContain('See your booking');
        expect(t.html).toContain(`background-color:${MAROON}`);
        [t.html, t.text, t.subject].forEach(body => {
          expect(body).not.toMatch(/message|write to (your )?coach|contact (your )?coach/i);
        });
      });

      it('prints no policy line when the free window has closed (it is not sent then, but must not print a blank)', () => {
        const closed = { ...reminderModel, freeUntilOpen: '', freeWindowOpen: false };
        const out = render(t.text, closed);
        expect(out).not.toMatch(/Free to cancel/);
        expect(out).not.toMatch(/until \./);
      });
    });

    it("no section prints a variable by name: inside one, only {{.}} (the section's own value) is safe", () => {
      SESSION_TEMPLATES.forEach(([alias, t]) => {
        [t.html, t.text].forEach(body => {
          const sections = body.match(/\{\{#(\w+)\}\}[\s\S]*?\{\{\/\1\}\}/g) || [];
          sections.forEach(section => {
            const inner = section
              .replace(/^\{\{#\w+\}\}/, '')
              .replace(/\{\{\/\w+\}\}$/, '')
              .replace(/\{\{\{?\s*\.\s*\}?\}\}/g, '');
            // A nested section is looked at on its own; here, no plain interpolation.
            const withoutNested = inner.replace(/\{\{#(\w+)\}\}[\s\S]*?\{\{\/\1\}\}/g, '');
            expect({
              alias,
              leftovers: withoutNested.match(/\{\{\{?\s*\w+\s*\}?\}\}/g) || [],
            }).toEqual({
              alias,
              leftovers: [],
            });
          });
        });
      });
    });
  });
});
