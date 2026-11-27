# Fictional demo world (Ostler Glance)

Everything below is invented. No real people, companies, or events. This file
is the canonical fixture for the whole week; the Day 6 demo video is recorded
against it. Every demo, test, and screenshot uses ONLY these names.

## The wearer (the "you" in the demo)

- **Henry Ashworth** — independent product consultant (fictional). Henry is
  forgetful with names and meets a lot of people at events. That is the
  problem Ostler Glance solves.

## The people Henry knows

| id | name | role | company | where met |
|---|---|---|---|---|
| per_eleanor_whitfield | Eleanor Whitfield | Events Director | Halcyon Summit (a fictional Hong Kong tech conference) | Speakers' reception, Oct 2026 |
| per_james_hardwick | James Hardwick | Co-founder & CEO | Ledger & Loom (fictional SaaS: bookkeeping for small textile workshops) | Intro call, Sep 2026 |
| per_rachel_fenwick | Rachel Fenwick | Principal | Cormorant Capital (fictional pre-seed fund) | Warm intro from a mutual friend, Oct 2026 |

## The fictional calendar (all times HKT)

### Past meeting 1 — 2026-11-04 (Wed) 10:00–10:45
"Coffee — Halcyon Summit speaker slot" with **Eleanor Whitfield**.
- Eleanor confirmed Henry as a track speaker. Henry's talk: "What consultants
  forget to write down".
- Promises made: Henry owes Eleanor the talk abstract (due 14 Nov — now overdue,
  the "you owe, N days" demo line). Eleanor owes Henry the speaker pass and AV
  checklist (delivered 12 Nov → status done).

### Past meeting 2 — 2026-11-11 (Wed) 16:00–16:30
"Call — Ledger & Loom integration" with **James Hardwick**.
- Discussed wiring Ledger & Loom's invoices into Ostler's capture flow.
- Promises made: James owes Henry API sandbox keys (due 18 Nov, still open —
  "they owe you" demo line). Henry owes James an intro to a pilot customer,
  **Marlow's Haberdashery** (fictional shop; due 28 Nov, open).

### Past meeting 3 — 2026-11-18 (Wed) 09:30–10:15
"Metrics review — Cormorant Capital" with **Rachel Fenwick**.
- Second conversation; Rachel is considering leading Henry's pre-seed round.
- Promises made: Henry owes Rachel the updated metrics deck (due 21 Nov —
  3 days overdue at kickoff, the hero line). Rachel owes Henry the term-sheet
  draft (due 25 Nov, open).

### Upcoming — 2026-11-30 (Mon) 14:00–14:30
"Halcyon Summit — speaker check-in" with **Eleanor Whitfield**, at the
Halcyon Summit pop-up office, Central (fictional address). This event powers
the Day 4 zero-prompt recall card (`GET /v1/next-card`).

## Recall triggers used in the demo

1. Calendar/event match (attendee = known person).
2. Name said in conversation (live catch).

Voice print / speaker identification is OUT of scope for the hackathon.
