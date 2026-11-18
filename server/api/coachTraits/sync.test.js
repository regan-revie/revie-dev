const { syncListingsFromProfile, fillProfileFromListings } = require('./sync');

const listing = (id, publicData) => ({ id: { uuid: id }, attributes: { publicData } });

describe('syncListingsFromProfile', () => {
  const profile = { languages: ['english'], location: 'middle-east' };

  it('writes only the changed traits, to each listing that needs them', async () => {
    const updateListing = jest.fn().mockResolvedValue({});
    const { changes } = await syncListingsFromProfile({
      userPublicData: profile,
      listings: [
        listing('a', {}),
        listing('b', { language: ['english'], coachlocation: 'middleeast' }),
        listing('c', { language: ['french'], coachlocation: 'middleeast' }),
      ],
      updateListing,
    });
    expect(updateListing).toHaveBeenCalledTimes(2);
    expect(updateListing).toHaveBeenCalledWith({
      id: { uuid: 'a' },
      publicData: { language: ['english'], coachlocation: 'middleeast' },
    });
    expect(updateListing).toHaveBeenCalledWith({
      id: { uuid: 'c' },
      publicData: { language: ['english'] },
    });
    expect(changes.map(c => c.listingId)).toEqual(['a', 'c']);
  });

  it('never clears a listing value when the profile has nothing', async () => {
    const updateListing = jest.fn();
    const { changes } = await syncListingsFromProfile({
      userPublicData: { languages: [], location: '' },
      listings: [listing('a', { language: ['english'], coachlocation: 'uk' })],
      updateListing,
    });
    expect(updateListing).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it('does nothing when listings are already in step (idempotent)', async () => {
    const updateListing = jest.fn();
    await syncListingsFromProfile({
      userPublicData: profile,
      listings: [listing('a', { language: ['english'], coachlocation: 'middleeast' })],
      updateListing,
    });
    expect(updateListing).not.toHaveBeenCalled();
  });

  it('reports the diff but writes nothing on a dry run', async () => {
    const updateListing = jest.fn();
    const { changes } = await syncListingsFromProfile({
      userPublicData: profile,
      listings: [listing('a', {})],
      updateListing,
      dryRun: true,
    });
    expect(updateListing).not.toHaveBeenCalled();
    expect(changes).toHaveLength(1);
  });

  it('keeps going when one listing fails, and reports it', async () => {
    const updateListing = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({});
    const { errors } = await syncListingsFromProfile({
      userPublicData: profile,
      listings: [listing('a', {}), listing('b', {})],
      updateListing,
    });
    expect(updateListing).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].listingId).toBe('a');
  });
});

describe('fillProfileFromListings', () => {
  it('writes the empty profile traits, and nothing on a dry run', async () => {
    const updateProfile = jest.fn().mockResolvedValue({});
    const args = {
      userId: 'u1',
      userPublicData: {},
      listings: [listing('a', { coachlocation: 'uk' })],
      updateProfile,
    };
    const dry = await fillProfileFromListings({ ...args, dryRun: true });
    expect(dry.traits).toEqual({ location: 'uk' });
    expect(updateProfile).not.toHaveBeenCalled();

    await fillProfileFromListings(args);
    expect(updateProfile).toHaveBeenCalledWith({ id: 'u1', publicData: { location: 'uk' } });
  });
});
