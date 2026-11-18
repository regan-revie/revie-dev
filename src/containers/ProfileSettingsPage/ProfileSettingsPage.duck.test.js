import { updateProfileThunk } from './ProfileSettingsPage.duck';

jest.mock('../../util/api', () => ({
  coachTraitsSyncMe: jest.fn(),
}));
jest.mock('../../util/data', () => ({
  denormalisedResponseEntities: jest.fn(),
}));
jest.mock('../../ducks/user.duck', () => ({
  setCurrentUser: user => ({ type: 'user/setCurrentUser', payload: user }),
}));

const { coachTraitsSyncMe } = require('../../util/api');
const { denormalisedResponseEntities } = require('../../util/data');

const userOfType = userType => ({ attributes: { profile: { publicData: { userType } } } });

const save = async userType => {
  denormalisedResponseEntities.mockReturnValue([userOfType(userType)]);
  const sdk = { currentUser: { updateProfile: jest.fn().mockResolvedValue({}) } };
  const dispatch = jest.fn();
  await updateProfileThunk({ publicData: {} })(dispatch, () => ({}), sdk);
  return dispatch;
};

describe("saving the profile copies a coach's traits to their listings", () => {
  beforeEach(() => {
    coachTraitsSyncMe.mockReset();
    coachTraitsSyncMe.mockResolvedValue({});
  });

  it('asks the server to sync after a coach saves', async () => {
    await save('coach');
    expect(coachTraitsSyncMe).toHaveBeenCalledTimes(1);
  });

  it('does nothing extra for a client', async () => {
    await save('client');
    expect(coachTraitsSyncMe).not.toHaveBeenCalled();
  });

  it('a failing sync never turns a saved profile into an error', async () => {
    coachTraitsSyncMe.mockRejectedValue(new Error('network'));
    const dispatch = await save('coach');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'user/setCurrentUser' }));
    // Let the swallowed rejection settle without an unhandled-rejection failure.
    await Promise.resolve();
  });
});
