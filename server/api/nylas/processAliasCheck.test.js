const {
  getProcessAliasProblem,
  assertProcessAliasMatchesListing,
  isCalendarListingSwitchedOff,
  assertCalendarListingBookable,
} = require('./processAliasCheck');

const calendarListing = alias => ({
  attributes: { publicData: { calendarBookingEnabled: true, transactionProcessAlias: alias } },
});

describe('getProcessAliasProblem()', () => {
  it("accepts a booking under the calendar listing's own alias", () => {
    expect(
      getProcessAliasProblem(calendarListing('default-booking/release-2'), {
        processAlias: 'default-booking/release-2',
      })
    ).toBeNull();
  });

  it('refuses another alias: release-1 would wait for a coach who is never asked', () => {
    const problem = getProcessAliasProblem(calendarListing('default-booking/release-2'), {
      processAlias: 'default-booking/release-1',
    });
    expect(problem).toMatch(/release-2/);
  });

  it('refuses a missing alias on a calendar listing', () => {
    expect(getProcessAliasProblem(calendarListing('default-booking/release-2'), {})).not.toBeNull();
  });

  it('refuses a calendar listing that has no alias of its own', () => {
    expect(getProcessAliasProblem(calendarListing(undefined), { processAlias: 'x/y' })).toMatch(
      /no transaction process/
    );
  });

  it('leaves listings that are not calendar listings alone', () => {
    const plain = {
      attributes: { publicData: { transactionProcessAlias: 'default-booking/release-1' } },
    };
    expect(getProcessAliasProblem(plain, { processAlias: 'anything/else' })).toBeNull();
  });
});

describe('assertProcessAliasMatchesListing()', () => {
  it('throws the 400 shape handleError understands', () => {
    try {
      assertProcessAliasMatchesListing(calendarListing('default-booking/release-2'), {
        processAlias: 'default-booking/release-1',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.statusText).toMatch(/release-2/);
      expect(e.data).toEqual({});
    }
  });

  it('does not throw for a match', () => {
    expect(() =>
      assertProcessAliasMatchesListing(calendarListing('default-booking/release-2'), {
        processAlias: 'default-booking/release-2',
      })
    ).not.toThrow();
  });
});

describe('a calendar session that has been switched off', () => {
  const listingWith = publicData => ({ attributes: { publicData } });
  const setUp = { nylasConfigurationIds: { 60: 'cfg-60' } };

  it("takes no new booking: it was set up on a calendar and is now off (the coach's Google connection broke)", () => {
    const off = listingWith({ ...setUp, calendarBookingEnabled: false });
    expect(isCalendarListingSwitchedOff(off)).toBe(true);
    expect(() => assertCalendarListingBookable(off)).toThrow('calendar-not-bookable');
  });

  it('the refusal is a 400 the checkout can name (a 409 would read as "that time was just taken")', () => {
    try {
      assertCalendarListingBookable(listingWith({ ...setUp, calendarBookingEnabled: false }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.data.errors[0].code).toBe('calendar-not-bookable');
    }
  });

  it('an older single-configuration listing counts as set up too', () => {
    expect(
      isCalendarListingSwitchedOff(
        listingWith({ nylasConfigurationId: 'cfg', calendarBookingEnabled: false })
      )
    ).toBe(true);
  });

  it('a bookable one is fine', () => {
    expect(() =>
      assertCalendarListingBookable(listingWith({ ...setUp, calendarBookingEnabled: true }))
    ).not.toThrow();
  });

  it('a listing that was never set up on a calendar is not touched by this check', () => {
    expect(isCalendarListingSwitchedOff(listingWith({ unitType: 'fixed' }))).toBe(false);
    expect(isCalendarListingSwitchedOff(listingWith({}))).toBe(false);
    expect(isCalendarListingSwitchedOff(undefined)).toBe(false);
  });
});
