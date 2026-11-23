const { parseCreateArgs, describeCode } = require('./cli');

describe('scripts/promo-codes.js create', () => {
  it('reads the NEWYEAR15 command: 15%, first session, 1 Feb 2027 midnight Los Angeles, 50 uses, 1 each', () => {
    const input = parseCreateArgs([
      'newyear15',
      '--percent',
      '15',
      '--first-session-only',
      '--expires',
      '2027-02-01 00:00',
      '--tz',
      'America/Los_Angeles',
      '--max-uses',
      '50',
      '--per-customer',
      '1',
    ]);
    expect(input.code).toBe('NEWYEAR15');
    expect(input.percentOff).toBe(15);
    expect(input.firstSessionOnly).toBe(true);
    // Midnight in Los Angeles in February is 08:00 UTC (PST, UTC-8).
    expect(input.expiresAt.toISOString()).toBe('2027-02-01T08:00:00.000Z');
    expect(input.maxTotalUses).toBe(50);
    expect(input.maxUsesPerCustomer).toBe(1);
  });

  it('reads the WELCOME10 command: no expiry, no cap, 1 each by default', () => {
    const input = parseCreateArgs(['WELCOME10', '--percent', '10', '--first-session-only']);
    expect(input).toMatchObject({
      code: 'WELCOME10',
      percentOff: 10,
      expiresAt: null,
      maxTotalUses: null,
      maxUsesPerCustomer: 1,
      firstSessionOnly: true,
    });
  });

  it('refuses a percentage above 15', () => {
    expect(() => parseCreateArgs(['BIG', '--percent', '16'])).toThrow(/15% ceiling/);
    expect(() => parseCreateArgs(['BIG', '--percent', '15.5'])).toThrow(/ceiling/);
    expect(parseCreateArgs(['OKAY', '--percent', '15']).percentOff).toBe(15);
  });

  it('refuses a missing or zero percentage, a bad code, and a bad number', () => {
    expect(() => parseCreateArgs(['ABC'])).toThrow(/--percent/);
    expect(() => parseCreateArgs(['ABC', '--percent', '0'])).toThrow();
    expect(() => parseCreateArgs(['--percent', '10'])).toThrow(/code/);
    expect(() => parseCreateArgs(['A B!', '--percent', '10'])).toThrow(/code/);
    expect(() => parseCreateArgs(['ABC', '--percent', '10', '--max-uses', 'many'])).toThrow(
      /whole number/
    );
    expect(() => parseCreateArgs(['ABC', '--percent', '10', '--per-customer', '0'])).toThrow();
  });

  it('will not guess a time zone for an expiry', () => {
    expect(() =>
      parseCreateArgs(['ABC', '--percent', '10', '--expires', '2027-02-01 00:00'])
    ).toThrow(/--tz/);
    expect(
      parseCreateArgs([
        'ABC',
        '--percent',
        '10',
        '--expires',
        '2027-02-01T00:00:00Z',
      ]).expiresAt.toISOString()
    ).toBe('2027-02-01T00:00:00.000Z');
    expect(() =>
      parseCreateArgs(['ABC', '--percent', '10', '--expires', 'next week', '--tz', 'Europe/London'])
    ).toThrow(/Could not read/);
  });
});

describe('describing a code', () => {
  it('shows the percentage, limits and live counts', () => {
    const line = describeCode({
      code: 'WELCOME10',
      percent_off: '10.00',
      active: true,
      expires_at: null,
      max_total_uses: null,
      max_uses_per_customer: 1,
      first_session_only: true,
      uses_so_far: 2,
      paid_count: 2,
      reserved_count: 1,
    });
    expect(line).toContain('WELCOME10  10% off');
    expect(line).toContain('ACTIVE');
    expect(line).toContain('first session only');
    expect(line).toContain('2 paid, 1 reserved');
  });
});
