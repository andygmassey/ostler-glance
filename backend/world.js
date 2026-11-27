// Fictional demo world for the Ostler Glance mock backend.
// EVERYTHING HERE IS INVENTED. See FICTIONAL_WORLD.md at the repo root.
// Canonical fixture for the whole hackathon week — do not edit casually.

export const PEOPLE = {
  per_eleanor_whitfield: {
    id: 'per_eleanor_whitfield',
    full_name: 'Eleanor Whitfield',
    company: 'Halcyon Summit',
    role: 'Events Director',
    where_met: "Speakers' reception, Oct 2026",
    met_at: '2026-10-21',
    personal_details: [
      'Training for the Harbour 10K, hates early starts',
      'Keeps a paper notebook for stage cues — no laptops in her run-of-show',
    ],
  },
  per_james_hardwick: {
    id: 'per_james_hardwick',
    full_name: 'James Hardwick',
    company: 'Ledger & Loom',
    role: 'Co-founder & CEO',
    where_met: 'Intro call, Sep 2026',
    met_at: '2026-09-30',
    personal_details: [
      'Ex-textile-loom mechanic; still fixes the studio machines himself',
      'Two whippets, Bruno and Cassie',
    ],
  },
  per_rachel_fenwick: {
    id: 'per_rachel_fenwick',
    full_name: 'Rachel Fenwick',
    company: 'Cormorant Capital',
    role: 'Principal',
    where_met: 'Warm intro from a mutual friend, Oct 2026',
    met_at: '2026-10-08',
    personal_details: [
      'Reads term sheets on paper with a green pen',
      'Sits on the board of a community theatre in Kennedy Town',
    ],
  },
}

// One ArtefactSet per past meeting (Ostler's 4 artefacts + promises).
export const MEETINGS = {
  mtg_20261104_eleanor_speaker_slot: {
    meeting_id: 'mtg_20261104_eleanor_speaker_slot',
    event_id: 'evt_20261104_eleanor_coffee',
    at: '2026-11-04T10:00:00+08:00',
    people: ['per_eleanor_whitfield'],
    artefact_set: {
      summary:
        'Eleanor confirmed Henry as a track speaker at Halcyon Summit. Talk title locked: "What consultants forget to write down". Stage B, 25-minute slot plus 5 minutes of questions.',
      to_dos: [
        { id: 'td_001', text: 'Send talk abstract to Eleanor', owner: 'Henry Ashworth', due: '2026-11-14', status: 'open', source: 'transcript' },
        { id: 'td_002', text: 'Send speaker pass and AV checklist to Alex', owner: 'Eleanor Whitfield', due: '2026-11-07', status: 'done', source: 'transcript' },
      ],
      cleaned_transcript:
        'ELEANOR: ...so Stage B, Thursday afternoon, twenty-five minutes plus five for questions. HENRY: Works. Title stays "What consultants forget to write down". ELEANOR: Send me the abstract by the fourteenth and I will put it in the programme. I will get you the speaker pass and the AV checklist by Friday. HENRY: Perfect. I will see you at the speaker check-in the day before.',
      details:
        "Eleanor runs the whole speaker programme solo and prefers short emails. The AV checklist matters to her because last year's clicker failed on Stage B mid-talk.",
      promises: [
        { id: 'pr_001', who: 'Eleanor Whitfield', direction: 'owed_by_me', what: 'Talk abstract', due: '2026-11-14', status: 'open', made_at: '2026-11-04', meeting_ref: 'mtg_20261104_eleanor_speaker_slot' },
        { id: 'pr_002', who: 'Eleanor Whitfield', direction: 'owed_to_me', what: 'Speaker pass and AV checklist', due: '2026-11-07', status: 'done', made_at: '2026-11-04', meeting_ref: 'mtg_20261104_eleanor_speaker_slot' },
      ],
    },
  },
  mtg_20261111_james_integration: {
    meeting_id: 'mtg_20261111_james_integration',
    event_id: 'evt_20261111_james_call',
    at: '2026-11-11T16:00:00+08:00',
    people: ['per_james_hardwick'],
    artefact_set: {
      summary:
        'Dev wants Ledger & Loom invoices flowing into Ostler-style capture flows. Agreed to try a sandbox integration before any paperwork. Pilot customer idea: Marlow\'s Haberdashery.',
      to_dos: [
        { id: 'td_003', text: 'Send API sandbox keys', owner: 'James Hardwick', due: '2026-11-18', status: 'open', source: 'transcript' },
        { id: 'td_004', text: 'Intro Dev to Marlow\'s Haberdashery (pilot)', owner: 'Henry Ashworth', due: '2026-11-28', status: 'open', source: 'transcript' },
      ],
      cleaned_transcript:
        "JAMES: The boring part of my customers' week is re-typing invoices. If your capture flow can read ours, that's the whole pitch. HENRY: Give me sandbox keys and I will wire something ugly but real. JAMES: Keys by next Tuesday. HENRY: And I owe you a pilot — Marlow's Haberdashery, my alterations guy. He still does invoices in a ledger book.",
      details:
        "Dev was a loom mechanic before Ledger & Loom; he demoed the product live on the call from his studio. Skeptical of partnerships that need lawyers before code.",
      promises: [
        { id: 'pr_003', who: 'James Hardwick', direction: 'owed_to_me', what: 'API sandbox keys', due: '2026-11-18', status: 'open', made_at: '2026-11-11', meeting_ref: 'mtg_20261111_james_integration' },
        { id: 'pr_004', who: 'James Hardwick', direction: 'owed_by_me', what: "Intro to Marlow's Haberdashery (pilot)", due: '2026-11-28', status: 'open', made_at: '2026-11-11', meeting_ref: 'mtg_20261111_james_integration' },
      ],
    },
  },
  mtg_20261118_rachel_metrics: {
    meeting_id: 'mtg_20261118_rachel_metrics',
    event_id: 'evt_20261118_rachel_review',
    at: '2026-11-18T09:30:00+08:00',
    people: ['per_rachel_fenwick'],
    artefact_set: {
      summary:
        "Second meeting with Rachel. She is considering leading Henry's pre-seed round. She wants the updated metrics deck before the term-sheet draft circulates.",
      to_dos: [
        { id: 'td_005', text: 'Send updated metrics deck', owner: 'Henry Ashworth', due: '2026-11-21', status: 'open', source: 'transcript' },
        { id: 'td_006', text: 'Circulate term-sheet draft', owner: 'Rachel Fenwick', due: '2026-11-25', status: 'open', source: 'transcript' },
      ],
      cleaned_transcript:
        "RACHEL: The first-deck numbers hung together, but they end in August. I cannot take a deck to committee that is three months stale. HENRY: You will have September and October by Friday. RACHEL: Then I circulate the term-sheet draft the following Tuesday. One thing at a time — deck first.",
      details:
        'Rachel reads everything on paper with a green pen and asked twice whether the retention numbers were cohort- or blended-based. Wants monthly cohorts in the deck.',
      promises: [
        { id: 'pr_005', who: 'Rachel Fenwick', direction: 'owed_by_me', what: 'Updated metrics deck (monthly cohorts)', due: '2026-11-21', status: 'open', made_at: '2026-11-18', meeting_ref: 'mtg_20261118_rachel_metrics' },
        { id: 'pr_006', who: 'Rachel Fenwick', direction: 'owed_to_me', what: 'Term-sheet draft', due: '2026-11-25', status: 'open', made_at: '2026-11-18', meeting_ref: 'mtg_20261118_rachel_metrics' },
      ],
    },
  },
}

export const EVENTS = {
  evt_halcyon_checkin: {
    id: 'evt_halcyon_checkin',
    title: 'Halcyon Summit — speaker check-in',
    starts_at: '2026-11-30T14:00:00+08:00',
    location: 'Halcyon Summit pop-up office, Central',
    attendees: ['per_eleanor_whitfield'],
  },
}

// Suggested openers, keyed by person.
export const OPENERS = {
  per_eleanor_whitfield: 'how the speaker rehearsals went.',
  per_james_hardwick: 'whether the sandbox keys worked for the invoice test.',
  per_rachel_fenwick: 'which retention view the committee prefers.',
}

// Draft actions per person (mock mode: confirm records completion).
export const ACTIONS = {
  per_eleanor_whitfield: [
    {
      id: 'act_011',
      kind: 'send_email',
      label: 'Send abstract email',
      draft: {
        to: 'eleanor.whitfield@halcyonsummit.example',
        subject: 'Talk abstract — "What consultants forget to write down"',
        body: 'Hi Eleanor, here is the abstract for Stage B, as promised...',
      },
      status: 'drafted',
    },
  ],
  per_james_hardwick: [
    {
      id: 'act_012',
      kind: 'send_email',
      label: 'Chase sandbox keys',
      draft: {
        to: 'james.hardwick@ledgerandloom.example',
        subject: 'Sandbox keys — invoice test',
        body: 'Hi Dev, checking in on the API sandbox keys...',
      },
      status: 'drafted',
    },
  ],
  per_rachel_fenwick: [
    {
      id: 'act_013',
      kind: 'send_email',
      label: 'Send metrics deck',
      draft: {
        to: 'rachel.f@cormorantcapital.example',
        subject: 'Updated metrics — monthly cohorts',
        body: 'Hi Rachel, the deck now runs September and October with monthly cohorts...',
      },
      status: 'drafted',
    },
  ],
}

// Live-catch dictionary: fictional names/companies/roles the mock can spot
// in transcript chunks (Day 2 hero, stubbed today).
export const LIVE_CATCH_PATTERNS = [
  { kind: 'name', text: 'Eleanor Whitfield' },
  { kind: 'name', text: 'James Hardwick' },
  { kind: 'name', text: 'Rachel Fenwick' },
  { kind: 'company', text: 'Halcyon Summit' },
  { kind: 'company', text: 'Ledger & Loom' },
  { kind: 'company', text: 'Cormorant Capital' },
]
