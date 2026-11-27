# DoraHacks submission text

## Short description (BUIDL page)

Ostler Glance — a first-meeting memory for Even G2 smart glasses.

It catches a new person's name, company and role while they're still
introducing themselves, farms a person card the moment the meeting ends
(what was agreed, who promised what), and brings the card back before
you walk into the room with them next time. One tap closes the loop:
the promised follow-up, drafted from the record and sent from your own
account.

Everything runs local: Whisper speech-to-text and the extraction model
run on the owner's own machine via ollama — no cloud model in the loop.
Audio is transcribed and deleted, never stored. Capture is tap-to-start
with a visible indicator, never always-on. No voice prints; recall
triggers are calendar match and name-said only.

"Names are everyone's nemesis. Ostler Glance never forgets one."

## Longer description (README / video page)

Even AI answers when you ask. Ostler Glance tells you before you walk
in. Where Even's Conversate captures the meeting, Ostler remembers the
people and the promises — across meetings, in files the owner controls,
with the promise ledger (what you owe, what they owe, how long it's been
open) leading the card instead of a summary.

Built for Even G2 with the Even Hub SDK. Contract-first text-in backend
(API_CONTRACT.yaml): the backend never sees raw audio. Pairing-code
auth. Open repo (viewing for judging; all rights reserved).

## Up to 5 API feature requests (draft)

1. A WebView wake-lock / foreground-keepalive API so tap-to-start
   capture survives WebView suspension without re-arming hacks.
2. A companion-app bridge to read the next calendar event's attendees
   (with permission) so recall cards can key off real events.
3. Text style control for TextContainer (font size / emphasis) for
   glance hierarchy on 576×288.
4. A hosted-STT option (or on-phone Whisper path) for apps that must
   not stream audio off-device — with the same delete-after-transcribe
   guarantee.
5. An explicit consent/indicator API (system-level "recording" glyph)
   so third-party capture apps inherit the platform's trust cue.
