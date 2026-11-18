# Onboarding fields

Every question coaches and clients answer, taken from Dev's hosted Console config (`users/user-fields.json`, `listings/listing-fields.json`) on 2026-11-18, plus the built-in fields. **Live was not checked** (no access from here); Test and Live may differ, see `tech-constraints.md`. A field's Console `required` flag is shown as Console has it; the code adds requirements on top, noted where they apply.

Where a field is stored: **user** fields live on the person (`publicData` is visible to everyone, `privateData` only to them); **listing** fields live on each session (`publicData`). Search can filter only on listing fields marked as search filters, never on user fields. That is why a coach's language, location, identity tags and communication style are asked once on the profile and **copied onto every listing by the server** (`server/api/coachTraits/`).

**Second tidy (2026-11-18, `onboarding-tidy-search-fallback`):** client sign-up cut to the essentials; gender (private `identity`) retired everywhere; a client's `support`, `work` and `client_wants` never shown publicly; new options and label fixes. Where a line below says "after the Console steps", the Console steps are in the HANDOFF of that day and in `go-live-plan.md`.

No field has help text in Console today (`helpText` is empty everywhere); the only help text is in code: the outcomes block in the session editor.

## How the coach-level traits flow

| Asked once on the profile (user, public) | Copied to every listing as | Search filter |
|---|---|---|
| `personality_identifier` "More about me..." | `identity` | secondary |
| `languages` | `language` | secondary |
| `location` | `coachlocation` | primary |
| `communication_style` (new; Console field not created until the steps in the HANDOFF are done) | `communication_style` | secondary |

Option keys differ in a few places, translated in code (`server/api/coachTraits/traits.js`), not renamed in Console:

| Trait | Profile option | Listing option |
|---|---|---|
| identity | `neurodivergent` | `neurdivergent` |
| identity | `empath` | `hsp` |
| identity | `chronic-illness` | `chronically-ill` |
| identity | `immigrant` | `expat` |
| identity | `first-generation` | `first-gen` |
| location | `middle-east` | `middleeast` |
| location | `latin-america` | `latam` |
| location | `south-america` | `southam` |

New options added in the second tidy use the **same key on both sides**, so they need no translation: identity `perimenopause`, `disabled`, `caregiver`; location `australia-nz`.

Never copied: the user's private `identity` ("How do you identify?", gender). It shares a key name with the listing `identity` tags but is a different question.

## Built-in (non-custom) fields

| Where | Field | Who | Required | Notes |
|---|---|---|---|---|
| Sign-up | Account type ("I'm looking for a coach" / "I'm a coach looking for clients") | all | yes | |
| Sign-up | First name, last name, email, password | all | yes | |
| Sign-up | Custom questions: **client** | client | | After the second tidy: only the age check. Location, gender, previous experience, support, intent, budget and other details are no longer asked at sign-up (fields and stored answers kept; clients can answer them on their profile or account page). |
| Sign-up | Custom questions: **coach** | coach | | Location (required, in code) and the age check. Certifications, other certifications and gender moved to the profile. |
| Sign-up | Display name | coach | no | **Dropped from sign-up** (Console step). Sharetribe is documented to show "First L." when there is none (to be confirmed with a test sign-up, see the HANDOFF). Existing coaches keep theirs. |
| Sign-up | Terms of service and privacy checkbox | all | yes | |
| Profile | Profile photo, bio | all | no | Public profile page |
| Session editor, Details | Title | coach | yes | |
| Session editor, Details | Description | coach | yes | Stays required |
| Session editor, Details | Listing type | coach | yes | Only one type exists ("Signature Session"), so it is not shown as a choice |
| Session editor, Pricing | Price variants (name, price, length; up to 20) | coach | price yes | |
| Session editor, Pricing | Start time interval | coach | yes | Probably moot now that Nylas sets slot steps; left alone |
| Session editor, Photos | Listing photos | coach | yes | |
| Account, Calendar | Connect calendar; working days, start, end, timezone | coach | to be bookable | Hours default to Mon-Fri 9-17 in the browser's zone |
| Account, Payout | Stripe Connect onboarding | coach | to be bookable | Stripe's own forms |

## User fields

### `location`: Where are you based?

- **Type / stored:** single choice, user `publicData`
- **Who:** coach and client
- **Required (Console):** yes ; **no after the Console steps**; **required of coaches in code** (sign-up and profile form)
- **In sign-up (Console now):** yes, and it stays on in Console, because Console cannot switch a field per user type. **Code hides it from client sign-up** (`src/util/userFieldPolicy.js`), so only coaches are asked.
- **Help text:** none
- **Where it is shown or used:** Coach sign-up (required) and profile; client profile (optional). Public profile page. **Copied to listings as `coachlocation`** (primary search filter).
- **Options (10; `australia-nz` added in the second tidy):**
  - `us`: US
  - `uk`: UK
  - `canada`: Canada
  - `europe`: Europe
  - `middle-east`: Middle East
  - `africa`: Africa
  - `asia`: Asia
  - `latin-america`: Latin America
  - `south-america`: South America
  - `australia-nz`: Australia & New Zealand (new)

### `work`: What's your current work situation?

- **Type / stored:** single choice, user `publicData`
- **Who:** client
- **Required (Console):** no
- **In sign-up (Console now):** no
- **Help text:** none
- **Where it is shown or used:** Client profile form. **Never shown on the public profile page** (code, `userFieldPolicy.js`; personal). Nowhere else.
- **Options (7):**
  - `full-time`: Full time
  - `fte-side-job`: Full time with a side hustle
  - `part-time-side-job`: Part time with a side hustle
  - `entrepreneur_business`: Business owner / entrepreneur
  - `freelancer`: Freelancer / consultant
  - `career-break`: Career break / in-between
  - `stay-at-home`: Stay at home

### `identity`: How do you identify?

- **Type / stored:** single choice, user `privateData`
- **Who:** coach and client
- **Required (Console):** no
- **In sign-up (Console now):** yes ; **no, after the Console steps**
- **Help text:** none
- **Where it is shown or used:** **Retired: asked nowhere** (not at sign-up, not on the profile, not in account settings; enforced in code, `userFieldPolicy.js`, so it holds whatever Console says). Stored answers are kept, untouched. Private: shown nowhere. **Never copied to listings.** Not the same question as the listing `identity` tags.
- **Options (7):**
  - `woman`: Woman
  - `man`: Man
  - `non-binary`: Non-binary
  - `transfeminine`: Transfeminine
  - `transmasculine`: Transmasculine
  - `genderqueer`: Genderqueer
  - `none`: I would rather not say.

### `pronouns`: What are your pronouns?

- **Type / stored:** single choice, user `publicData`
- **Who:** coach and client
- **Required (Console):** no
- **In sign-up (Console now):** no
- **Help text:** none
- **Where it is shown or used:** Profile. Public profile page.
- **Options (6):**
  - `she-her`: she/her
  - `he-him`: he/him
  - `they-them`: they/them
  - `she-they`: she/they
  - `he-they`: he/they
  - `other`: other

### `languages`: What languages do you speak?

- **Type / stored:** multiple choice, user `publicData`
- **Who:** coach and client
- **Required (Console):** no ; **required of coaches in code** (profile form)
- **In sign-up (Console now):** no
- **Help text:** none
- **Where it is shown or used:** Profile. Public profile page. **Copied to listings as `language`** (search filter).
- **Options (9):**
  - `english`: English
  - `spanish`: Spanish
  - `french`: French
  - `italian`: Italian
  - `hebrew`: Hebrew
  - `mandarin`: Mandarin
  - `japanese`: Japanese
  - `portuguese`: Portuguese
  - `arabic`: Arabic

### `previous_experience`: Have you ever worked with a coach or therapist before?

- **Type / stored:** single choice, user `privateData`
- **Who:** client
- **Required (Console):** yes ; **no after the Console steps** (otherwise a client could not save their account page without answering)
- **In sign-up (Console now):** yes ; **no, after the Console steps**
- **Help text:** none
- **Where it is shown or used:** Client account page (optional). Private: shown nowhere; stored for the matching quiz, which is not built.
- **Options (4):**
  - `previous-coach`: Coach
  - `previous-therapist`: Therapist
  - `previous-unsure`: I'm not sure
  - `previous-new`: I'm new to both!

### `support`: Here's how I'm looking to grow...

- **Type / stored:** multiple choice, user `publicData`
- **Who:** client
- **Required (Console):** yes ; **no after the Console steps**
- **In sign-up (Console now):** yes ; **no, after the Console steps**
- **Help text:** none
- **Where it is shown or used:** Client profile form (optional). **Never shown on the public profile page** (code). Stored for the matching quiz, which is not built. Its options are compared with the session categories at the end of this file.
- **Options (15):**
  - `time-management`: Time management
  - `confidence`: Speaking up / Confidence
  - `work-life-balance`: Work-life balance
  - `career-pivot`: Career pivot
  - `leadership`: Leadership skills
  - `communication`: Communication
  - `stress`: Reducing stress
  - `boundaries`: Boundary setting
  - `promotion`: Getting a promotion
  - `hormones`: Working with my cycle
  - `relationships`: Relationships
  - `entrepreneur`: Starting my business
  - `money`: Managing my money
  - `style`: Personal style
  - `nutrition`: Nutrition

### `client_wants`: My ideal coach will...

- **Type / stored:** multiple choice, user `publicData`
- **Who:** client
- **Required (Console):** no
- **In sign-up (Console now):** no
- **Help text:** none
- **Where it is shown or used:** Client profile form. **Never shown on the public profile page** (code). Stored for the matching quiz, which is not built.
- **Options (4):**
  - `aggressive-coach`: Push me out of my comfort zone.
  - `soft-coach`: Make me feel safe and understood.
  - `involved-coach`: Keep me accountable, no excuses.
  - `brainstorm-coach`: Help me discover new opportunities.

### `intent`: How ready are you to start working with someone?

- **Type / stored:** single choice, user `privateData`
- **Who:** client
- **Required (Console):** yes ; **no after the Console steps**
- **In sign-up (Console now):** yes ; **no, after the Console steps**
- **Help text:** none
- **Where it is shown or used:** Client account page (optional). Private: shown nowhere; stored for the matching quiz, which is not built.
- **Options (2):**
  - `high-intent`: I'm ready to start now.
  - `exploration-phase`: I'm exploring my options.

### `personality_identifier`: More about me...  (label becomes "Lived experience (clients can filter by this)")

- **Type / stored:** multiple choice, user `publicData`
- **Who:** coach and client
- **Required (Console):** no ; **required of coaches in code** (profile form)
- **In sign-up (Console now):** no
- **Help text:** none
- **Where it is shown or used:** Profile ("More about me..."). Public profile page. **Copied to listings as `identity`** (search filter).
- **Options (18; three added in the second tidy; labels as they will read after the Console steps):**
  - `neurodivergent`: ADHD / Autism / Neurodivergence
  - `introvert`: Introvert
  - `extrovert`: Extrovert
  - `ambivert`: Ambivert (both introverted & extroverted)
  - `empath`: Highly sensitive or empathic
  - `chronic-illness`: Chronic illness (was "Chronic Illness")
  - `burnout`: Burnout
  - `mental-health`: Mental health cycles (anxiety, depression, etc)
  - `queer`: LGBTQIA+
  - `poc`: Person of color
  - `parent`: Parent
  - `single-parent`: Single parent
  - `immigrant`: Expat / immigrant (was "Expat / Immigrant")
  - `ex-corporate`: Ex-corporate
  - `first-generation`: First generation (was "First-generation")
  - `perimenopause`: Perimenopause / menopause (new)
  - `disabled`: Disabled (new)
  - `caregiver`: Caregiver (new)

### `budget`: What's your budget per session?

- **Type / stored:** multiple choice, user `privateData`
- **Who:** client
- **Required (Console):** yes ; **no after the Console steps**
- **In sign-up (Console now):** yes ; **no, after the Console steps**
- **Help text:** none
- **Where it is shown or used:** Client account page (optional). Private: shown nowhere; stored for the matching quiz, which is not built.
- **Options (4):**
  - `low`: $50-$100
  - `medium`: $100-$200
  - `high`: $200-$400
  - `top-spender`: $400+

### `other_details`: Anything else we should know to help you match with your ideal coach?

- **Type / stored:** long text, user `privateData`
- **Who:** client
- **Required (Console):** no
- **In sign-up (Console now):** yes ; **no, after the Console steps**
- **Help text:** none
- **Where it is shown or used:** Client account page (optional). Private: shown nowhere; stored for the matching quiz, which is not built.

### `focusareas`: Tools & Modalities

- **Type / stored:** multiple choice, user `publicData`
- **Who:** coach
- **Required (Console):** no
- **In sign-up (Console now):** no
- **Help text:** none
- **Where it is shown or used:** Coach profile. Public profile page. Not a search filter; the session page redesign shows it as "tools".
- **Options (22):**
  - `nervous-system`: Nervous system regulation
  - `somatics`: Somatics
  - `habitdesign`: Habit design
  - `behaviorpsych`: Behavioral psychology
  - `energy`: Energy management
  - `cycle-syncing`: Cycle syncing
  - `feminism`: Feminist frameworks
  - `systems`: Systems thinking
  - `routines`: Ritual / routine curation
  - `style`: Personal style
  - `self-expression`: Self-expression
  - `space-design`: Home, space, or environment design
  - `mindfulness`: Mindfulness
  - `nutrition`: Nutrition
  - `wellness`: Wellness integration
  - `career`: Career strategy
  - `business`: Business strategy
  - `values`: Values-based goal setting
  - `inner-child`: Inner child / emotional work
  - `identity`: Identity / purpose exploration
  - `change-theory`: Theory of personal change
  - `reframing`: Mindset reframing

### `certifications`: Your certifications

- **Type / stored:** multiple choice, user `publicData`
- **Who:** coach
- **Required (Console):** no
- **In sign-up (Console now):** yes ; **no, after the Console steps**
- **Help text:** none
- **Where it is shown or used:** Coach sign-up now; profile after the Console steps. Public profile page.
- **Options (5; one added in the second tidy):**
  - `acc`: ICF Certified Coach (ACC)
  - `pcc`: ICF Certified Coach (PCC)
  - `mcc`: ICF Certified Coach (MCC)
  - `cpc`: Certified Professional Coach (CPC)
  - `emcc`: EMCC accredited coach (new)

### `othercerts`: Other diplomas / certifications

- **Type / stored:** long text, user `publicData`
- **Who:** coach
- **Required (Console):** no
- **In sign-up (Console now):** yes ; **no, after the Console steps**
- **Help text:** none
- **Where it is shown or used:** Coach sign-up now; profile after the Console steps. Public profile page.

### `sociallink`: Social Media Link

- **Type / stored:** long text, user `publicData`
- **Who:** coach
- **Required (Console):** no
- **In sign-up (Console now):** no
- **Help text:** none
- **Where it is shown or used:** Coach profile. Public profile page.
- **Decision (second tidy): left as long text.** Console's short text type (`shortText`) is capped at 70 characters by the stock input, and profile links often run longer (a LinkedIn or personal-site URL), so any coach already holding a longer value would be unable to save their profile until they shortened it. Whether Console even lets a field's type be edited after creation could not be confirmed. The gain is cosmetic.

### `ageverification`: Are you over 18?

- **Type / stored:** multiple choice, user `privateData`
- **Who:** coach and client
- **Required (Console):** yes
- **In sign-up (Console now):** yes
- **Help text:** none
- **Where it is shown or used:** Sign-up (required, everyone). Private: shown nowhere.
- **Options (2):**
  - `yes`: Yes
  - `no`: No

### `communication_style`: planned, not in Console yet

- **Type / stored:** multiple choice, user `publicData`
- **Who:** coach
- **Required:** no in Console; **required of coaches in code** (profile form). Until the field exists the profile does not ask it and the "Finish your profile" row does not count it.
- **In sign-up:** no
- **Where it is shown or used:** Coach profile. Public profile page. **Copied to listings as `communication_style`** (search filter).
- **Options (6), same keys as the listing field:**
  - `direct`: Direct
  - `empathetic`: Empathetic
  - `analytical`: Analytical
  - `supportive`: Supportive
  - `challenging`: Challenging
  - `intuitive`: Intuitive

## Listing fields

### `identity`: Identity & Background

- **Type / stored:** multiple choice, listing `publicData`
- **Required (Console):** yes ; **no longer enforced by the editor** (the field is hidden; the Console flag is turned off in the HANDOFF steps)
- **Search:** search filter, secondary group, indexed
- **Help text:** none
- **Where it is shown or used:** Search filter (secondary). Listing page details. **Filled by the server from the coach's profile `personality_identifier`; not asked in the session editor.**
- **Options (18; three added in the second tidy; labels as they will read after the Console steps):**
  - `neurdivergent`: ADHD / Autism / Neurodivergence (stray trailing space removed)
  - `introvert`: Introvert
  - `extrovert`: Extrovert
  - `ambivert`: Ambivert (both introverted / extroverted)
  - `chronically-ill`: Chronic illness (was "Chronic Illness")
  - `hsp`: Highly sensitive or empathic
  - `burnout`: Burnout
  - `mental-health`: Mental health cycles
  - `queer`: LGBTQIA+
  - `poc`: Person of color
  - `parent`: Parent
  - `single-parent`: Single parent (was "Single Parent")
  - `expat`: Expat / immigrant
  - `ex-corporate`: Ex-corporate
  - `first-gen`: First generation
  - `perimenopause`: Perimenopause / menopause (new)
  - `disabled`: Disabled (new)
  - `caregiver`: Caregiver (new)

  Not aligned, only noted: the profile's "Mental health cycles (anxiety, depression, etc)" and "Ambivert (both introverted & extroverted)" read slightly differently from this side. Left alone; the keys map correctly.

### `communication_style`: Communication Style

- **Type / stored:** multiple choice, listing `publicData`
- **Required (Console):** yes ; **no longer enforced by the editor** (the field is hidden; the Console flag is turned off in the HANDOFF steps)
- **Search:** search filter, secondary group, indexed
- **Help text:** none
- **Where it is shown or used:** Search filter (secondary). Listing page details. **Filled by the server from the coach's profile `communication_style`; not asked in the session editor.**
- **Options (6; labels capitalised in the second tidy, keys unchanged):**
  - `direct`: Direct (was "direct")
  - `empathetic`: Empathetic
  - `analytical`: Analytical
  - `supportive`: Supportive
  - `challenging`: Challenging
  - `intuitive`: Intuitive

### `structure`: Session Structure

- **Type / stored:** single choice, listing `publicData`
- **Required (Console):** yes
- **Search:** search filter, secondary group, indexed
- **Help text:** none
- **Where it is shown or used:** Search filter (secondary). Listing page details. Asked per session in the session editor.
- **Options (3):**
  - `highly-structured`: Highly structured (was "highly structured")
  - `flexible`: Flexible / adaptive (was "flexible / adaptive")
  - `client-led`: Led by you (was "entirely led by you")

### `language`: Session Language Options

- **Type / stored:** multiple choice, listing `publicData`
- **Required (Console):** yes ; **no longer enforced by the editor** (the field is hidden; the Console flag is turned off in the HANDOFF steps)
- **Search:** search filter, secondary group, indexed
- **Help text:** none
- **Where it is shown or used:** Search filter (secondary). Listing page details. **Filled by the server from the coach's profile `languages`; not asked in the session editor.**
- **Options (9):**
  - `english`: English
  - `spanish`: Spanish
  - `french`: French
  - `italian`: Italian
  - `hebrew`: Hebrew
  - `mandarin`: Mandarin
  - `japanese`: Japanese
  - `portuguese`: Portuguese
  - `arabic`: Arabic

### `coachlocation`: Coach Location

- **Type / stored:** single choice, listing `publicData`
- **Required (Console):** yes ; **no longer enforced by the editor** (the field is hidden; the Console flag is turned off in the HANDOFF steps)
- **Search:** search filter, primary group, indexed
- **Help text:** none
- **Where it is shown or used:** Search filter (primary). Listing page details. **Filled by the server from the coach's profile `location`; not asked in the session editor.**
- **Options (10; `australia-nz` added in the second tidy):**
  - `us`: US
  - `canada`: Canada
  - `europe`: Europe
  - `uk`: UK
  - `middleeast`: Middle East
  - `africa`: Africa
  - `asia`: Asia
  - `latam`: Latin America
  - `southam`: South America
  - `australia-nz`: Australia & New Zealand (new)

### `pre_work`: What happens before the session?

- **Type / stored:** long text, listing `publicData`
- **Required (Console):** no
- **Search:** not a search filter
- **Help text:** none
- **Where it is shown or used:** Session page, as a text section. Asked per session. Not a filter.

### `outcome_1`: Outcome 1

- **Type / stored:** short text (90 characters, enforced in code), listing `publicData`
- **Required (Console):** yes ; also enforced in code with a 90-character limit
- **Search:** not a search filter
- **Help text:** "What will your client leave with? Be specific. One line each." (in code, shown once above the three outcome fields, with three examples)
- **Where it is shown or used:** Session editor (required). Session page, numbered list "You'll walk away with" (hidden unless outcome 1 has text). Not a filter. Not repeated in the Details list.

### `outcome_2`: Outcome 2

- **Type / stored:** short text (90 characters, enforced in code), listing `publicData`
- **Required (Console):** no ; also enforced in code with a 90-character limit
- **Search:** not a search filter
- **Help text:** none
- **Where it is shown or used:** Session editor (optional). Session page, in the same numbered list.

### `outcome_3`: Outcome 3

- **Type / stored:** short text (90 characters, enforced in code), listing `publicData`
- **Required (Console):** no ; also enforced in code with a 90-character limit
- **Search:** not a search filter
- **Help text:** none
- **Where it is shown or used:** Session editor (optional). Session page, in the same numbered list.

## Session categories ("How do you want to grow?") next to the client support options

Two different questions that describe the same ground, kept apart so far:

- The **session category** is asked of the coach per session (`listings/listing-categories.json`, one choice, 11 options). It is the category filter on search. The text "How do you want to grow?" is not in the code or in the hosted files read for this table (the app labels the filter "Category"); the name is taken from the request.
- The client's **support** answer is asked of a client (user field `support`, multiple choice, 15 options). Stored for the matching quiz, which is not built, and never shown publicly.

They share no keys. A first pass at lining them up, as a proposal for later (nothing here is wired to anything):

| Session category (key: label) | Closest client support option(s) (key: label) |
|---|---|
| `wlb`: Better work life balance | `work-life-balance`: Work-life balance |
| `career`: Career growth | `career-pivot`: Career pivot; `promotion`: Getting a promotion |
| `confidence`: Speaking up / confidence | `confidence`: Speaking up / Confidence |
| `personal_style`: Personal Style | `style`: Personal style |
| `relationships`: Improving relationships | `relationships`: Relationships |
| `nutrition`: Nutrition / Health | `nutrition`: Nutrition |
| `finance`: Managing finances | `money`: Managing my money |
| `entrepreneurship`: Entrepreneurship | `entrepreneur`: Starting my business |
| `neurodivergence`: Understanding neurodivergence | (none) |
| `purpose`: Finding purpose | (none) |
| `parenthood`: Parenthood | (none) |
| (none) | `time-management`: Time management |
| (none) | `leadership`: Leadership skills |
| (none) | `communication`: Communication |
| (none) | `stress`: Reducing stress |
| (none) | `boundaries`: Boundary setting |
| (none) | `hormones`: Working with my cycle |

Gaps to decide when aligning: three categories have no client option (neurodivergence, purpose, parenthood), six client options have no category (time management, leadership, communication, stress, boundaries, cycle), and two client options (career pivot, promotion) fold into one category. The labels are also in different voices: categories name a topic ("Career growth"), support options name an action or goal ("Getting a promotion"), and the client's own heading is "Here's how I'm looking to grow...".
