import { SearchCTA } from './SearchCTA';

// The landing-page hero search, with the keyword and category fields, on a plain ground.
export const KeywordAndCategory = {
  component: SearchCTA,
  props: { searchFields: { categories: true, keywordSearch: true } },
  group: 'misc',
};
