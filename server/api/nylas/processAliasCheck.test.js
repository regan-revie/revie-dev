const { getProcessAliasProblem, assertProcessAliasMatchesListing } = require('./processAliasCheck');

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
