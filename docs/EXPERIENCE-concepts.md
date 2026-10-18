# Experience concepts: from portfolio to a place you visit

Companion to `PLAN-llm-3d-character.md`. That doc covers how to build the character. This one covers what the site should feel like around him.

Built from the approach in your other work. Four States has an entrance drawn from the real threshold, one hero interaction tied to the real space, a chapter per pillar with its own visual language, sound that stays off until asked, and a launch film. Syntique's line is "Most websites are brochures. Ours are machines." Nothing below invents facts about you. Every project detail and number has to come from you.

## The spine: one table, one working day

The whole site is his café table, and scrolling moves through one working day.

| Scroll | Time of day | What's on the table | Content |
|---|---|---|---|
| Arrival | Morning, first coffee | Cup steaming, laptop closed | Who he is, one line |
| Deep work | Late morning | Laptop open, headphones nearby | Selected work, one chapter per project |
| The call | Afternoon | Phone face-up, notebook open | How he works with clients, process |
| Shipping | Evening, lamp on | Terminal on screen | Stack, what he builds with |
| Last order | Night | Cup empty, laptop lid half closed | Contact / hire |

Light and colour shift with the scroll, the way the lanterns change Four States. The visitor's real clock sets the starting light. Someone visiting at 1 a.m. finds him still at it, headphones on.

Alternatives, if this spine doesn't fit:
- **Inside the laptop.** The camera pushes into his screen and the site lives in there. It is stronger for showing systems, but you lose the character for most of the scroll.
- **Earn his attention.** Content unlocks as you bother him. It is the most playful option, but it fights recruiters who want facts fast. It works only as a layer on top, not as the spine.

## Moments

### 1. The threshold
The loader already shows him holding coffee. End it with a choice: **"Pull up a chair"** or **"Just looking"**. Pulling up the chair scrapes it back and turns on the café sound, like turning the brass handle. "Just looking" enters silently. Same idea as Four States, drawn from this scene.

### 2. The hero hook: touch his table
On Four States you light the real lanterns. Here, you mess with his real things:
- **Drag his coffee cup away.** He reaches for it without looking, finds nothing, then looks at you.
- **Close his laptop lid.** He looks up, deadpan, and opens it again. Do it twice and the headphones go on.
- **Tap the notebook.** It flips to a page of his actual sketches or notes, if you have any to share.

This turns the existing click escalation (cheers → eyebrow → headphones) into objects you can handle. That's more physical, and easier to discover.

### 3. Talk to him
The LLM layer from the plan. What makes it his:
- **Mood is earned.** It comes from what you did at the table. If you stole his coffee, the first answer is short.
- **He gives the tour.** Ask "what have you built?" and he turns the laptop toward you while the page moves to that chapter.
- **He knows only what you wrote.** Ask him something outside that and he says "ask the real me", with the contact link.

### 4. Project chapters that run, not screenshots
Syntique's line, applied to your own work. Each project gets its own visual language borrowed from that project, like each Four States pillar wore its own textile. Each one also gets a small live machine:
- **A booking platform:** a phone on the table buzzes with a WhatsApp OTP. You tap it, a booking confirms, and a payment webhook ticks into a log on his laptop. You see the system working, not a mockup of it.
- **A restaurant experience:** the laptop screen glows with a lantern you can light. That small piece of the real site sits inside this one.
- **A donation platform:** one tap donates fake money, and a CRM record appears in a side panel.
- **Automation work:** a reel assembles itself on his screen from raw clips while you watch.

The client names, metrics and screenshots stay out until you confirm which ones you're allowed to show on a personal portfolio.

### 5. Sound, off until asked
- Café room tone, and keyboard clicks that follow his typing animation.
- His voice. ElevenLabs can clone your own voice, which beats any stock voice. Your sessions already handle pronunciations; reuse that list.
- A short spoken welcome when you pull up the chair.
- Never sound over speech, as in your Four States brief.

### 6. Real signals, not decoration
- **"Last shipped"**: the date and time of the most recent production deploy of this site, read from Vercel. It is true by construction.
- **The status line** (already in the header) reflects what he is actually doing in the scene, and later the conversation state.

### 7. Leave a note on his laptop
Visitors can leave a short sticky note on the laptop lid. It is shared, so the next visitor sees the latest few. He reads one aloud when he takes a break. This needs moderation: hold notes for approval, or filter them before showing.

### 8. Hiring ends in a brief, not a form
Your restaurant questionnaire turns answers into a brief. Do the same here:
- At "Last order", the chat condenses into a short project brief.
- The visitor checks it and sends it.
- It reaches you on WhatsApp through WATI, which you've already integrated, or by email.

### 9. The recruiter fast lane
One visible button: "Just the facts". He drops the act, sits up, and the page collapses into a one-screen CV with a download. Always one tap away, like "Book a table".

### 10. The launch film
A 20–30 second HyperFrames film: the threshold, the coffee theft, the laptop turning around, and the night shot. Make 16:9 for the site and 9:16 for reels. Your reel automation pipeline can cut variants from it.

### 11. Small secrets
- Type `sudo` in the chat and he says "nice try".
- At night, with headphones on, he hums. Sound on only.
- Leave the tab and come back after a while: he has a fresh coffee and says "oh, you're back".

## Quality bar (from your Four States brief)

- Animate only transform and opacity in the DOM. Measure frame times on a phone before calling a moment done.
- No flat backgrounds: paper grain and soft light around the table.
- `prefers-reduced-motion` keeps the poster and the text. The chat still works without 3D.
- Every moment also works by keyboard and touch. Touch has no cursor, so taps replace hovering.

## What I need from you

1. Is this your personal portfolio, or does it overlap with Syntique? This decides which projects and voice it uses.
2. Which projects, client names and numbers are you allowed to show here?
3. Do you have notes, sketches or real artefacts for the notebook and the chapters?
4. Are you OK with using your own voice, and with visitor notes (needs moderation)?
