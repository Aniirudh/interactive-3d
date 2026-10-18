# Still Compiling: a short film about Aniruddha that you can interrupt

Working title. Status: treatment for approval. Nothing below is generated or built yet.

This replaces the "3D chatbot on a portfolio" framing in `PLAN-llm-3d-character.md`. The character stays. What changes is the form: the site becomes a short documentary about you, starring your character and narrated in your own voice. The visitor can stop it at any moment and talk to you.

## Why a documentary

A portfolio lists what you made. A documentary shows who made it. The format that makes strangers feel they know someone is the talking-head documentary: a person speaking to camera, cut with footage of their world. Your character already looks like you, and your cloned voice sounds like you. Put them in that format and the visitor sits across the table from you for four minutes.

## The one mechanic: interrupt the film

At any moment the visitor can raise a hand: a button, the space bar, or saying "hey" into the mic.
- The film freezes and the score ducks. He looks up from the laptop toward the camera: "Yeah?"
- The visitor asks anything, by text or voice. He answers in your voice, from facts you've written and nothing else.
- If the answer lives later in the film, he says "Actually, let me show you" and the film jumps there.
- When they're done: "Anyway. Where was I." The film picks up where it stopped.

No other portfolio does this. Everything else in the treatment serves it.

### How the lips stay in sync (the film-craft trick)

- **Scripted lines** are lip-synced properly. The character shot comes from Kling 3, the line comes from your voice clone, and Sync 3 dubs the shot.
- **Live answers** can't be lip-synced in real time. Documentaries solve this every day with cutaways: while he talks we see over his shoulder, his hands on the keyboard, the cup at his mouth, his silhouette against the window. A library of about 8 such loops covers any number of live answers, and the mouth is never on screen out of sync.

So version 1 needs no 3D rig. The 3D plan becomes an optional later upgrade.

## Structure: five reels, built from your real history

Your GitHub history dates every era, so the chapters are true. Each reel has its own film look: grainier and warmer early on, crisper and cooler by 2026.

| Reel | Years (from repo dates) | Anchors that exist | The question only you can answer |
|---|---|---|---|
| Cold open | now | Café, laptop, coffee | — |
| 1. Hello, World | 2021–22 | BNMIT-csi, four separate to-do apps, Full-Stack, startup, SOTD, Kalabhageerathi site | How did you start? Why four to-do apps? |
| 2. Copying the greats | 2023–24 | Google Keep (web + Android), Netflix (web + Android), brewHaven, tatva23, Backend-Newsfeed, internship | What did rebuilding real products teach you? |
| 3. Real people, real money | 2025–26 | turiniq, LeadGen, fi, native chat, Sisters In Sweat, Chitrapur Heritage Foundation, TimBuckDo, CareerView, finance tracker, RAG | First time someone paid you for code? Your role in each? |
| 4. Making things feel | 2026 | Four States, Syntique, reel automation, this site | Why move from systems into experiences? |
| 5. Your scene | now | The visitor | What do you want to build next, and with whom? |

### Cold open
Black screen, café room tone, typing. Your voice: *"Hey. Sorry, give me a second, I'm pushing something."* A commit chime. Title card: **STILL COMPILING**.

Then three ways in:
- **Watch the film** (about 4 minutes)
- **The 60-second cut**
- **Just the facts**: a one-screen CV, for recruiters

### Projects: the scene is the metaphor, the laptop is the proof
Every major project gets a short scene with the character inside that project's world:
- **Four States:** he carries a flame to a lantern.
- **Sisters In Sweat:** phones light up across a night-time city map, one per WhatsApp login.
- **Google Keep clone:** sticky notes swarm the table.
- **RAG:** a library whose books answer back.
- **Reel automation:** clips assemble themselves into a reel on his screen.

Then he turns the laptop toward camera. The real product plays on the screen as a screen recording composited with Remotion, with on-screen facts taken from your case studies. "Step inside" opens the live site.

Smaller and older repos don't get scenes. They go by in a fast film-strip montage, with each repo's commit date as the timecode.

### Reel 4 shows the film being made
He turns the laptop around and shows the storyboard of the film you're watching: the prompts, the voice flow, the shot list. The site shows how it was made, and that is itself the strongest proof of the "making things feel" reel.

### Reel 5 casts the visitor
The conversation so far becomes a short brief: what they asked and what they might want built. The visitor checks it and sends it to your WhatsApp through WATI, or by email. They can also leave a 30-second voice note that you answer personally.

### Credits, rendered live
The end credits are rendered in the browser with the Remotion Player, so they can be personal:
- *Starring Aniruddha. Voice: Aniruddha (yes, really). Score: …*
- *Special thanks: Priya, who asked about Razorpay webhooks.* The visitor's name and their actual question.
- Then a **blooper reel**: the AI takes that went wrong, like extra fingers and a melting cup. It's funny and honest, and on-theme for a film about making things.
- Post-credits: he finally finishes the coffee. "Build passed."

The visitor can download a postcard clip of the credits with their name in it. That gives people a reason to share the site.

## Making it feel like you

- **Your real voice everywhere**, including live answers.
- **Real time.** The light follows Bengaluru's actual clock. Visit at 11 p.m. IST and he's in the night scene with headphones on.
- **Memory.** Return visitors get "You came back. Reel 3 again?" (stored only in their browser).
- **Personal truths only.** Every line comes from your answers to the interview below. Nothing is invented.

## Sound
- **Music:** one continuous score from ElevenLabs Music. The motif changes with each reel, and it always ducks under speech.
- **Sound effects:** café room tone (looped), keys, a cup set down, a chair scrape, a phone buzz, a projector starting, the reel-change click, a commit chime.
- **Headphones on:** the whole site goes low-pass, so you hear what he hears, with his music leaking faintly.
- Sound is off until the visitor opens with it, as on Four States.

## Production pipeline

| Asset | Tool | Note |
|---|---|---|
| Storyboard frames and keyframes | Nano Banana Pro (via ElevenLabs) | Cheap; you approve these first |
| Character shots | Kling 3 Pro (via ElevenLabs), using the repo's headshot and clips as references | The main cost; only approved keyframes get animated |
| Lip-sync | Sync 3 | Scripted lines only |
| Voice | Your clone (to be confirmed) | |
| Music and sound effects | ElevenLabs | |
| Live credits and postcard | Remotion Player in the browser | |
| Trailer and social cuts | HyperFrames, 16:9 + 9:16 | Feeds your reel pipeline |
| Site | Existing Vite + React. The clip state machine becomes a shot director | |
| Live answers | Claude via a Vercel function, plus your voice clone | |

### Cost (from ElevenLabs estimates in your workspace, 18 Oct 2026)

| Item | Credits | About |
|---|---|---|
| One Kling 3 Pro shot (default length) | ~5,090 | ₹81 |
| One Veo 3.1 shot | ~19,390 | ₹310 |
| One music track | ~1,650 | ₹26 |
| One narration line, 4 takes | ~460 | ₹7 |

Kling is about a quarter of Veo's price here, so Kling is the default. A film of about 30 shots comes to roughly 150,000 credits before retakes and lip-sync. Keyframes first, then video only for approved shots, keeps retakes down.

## The interview I need from you

The film can't be personal without your answers. Voice notes are fine; I can transcribe them.
1. Where did you grow up, and what's the first thing you built on a computer?
2. BNMIT: what did you study, and what from college do you still use?
3. Why rebuild Keep and Netflix? What did each one teach you?
4. What was the first thing someone paid you to build?
5. For each of Sisters In Sweat, Chitrapur Heritage Foundation, TimBuckDo, CareerView and Four States: what was your role, and one moment you're proud of?
6. What is Syntique, who runs it with you, and can they be named or shown?
7. What do you want to build next, and who should get in touch?
8. Your real coffee order, and where you drink it.
9. What do you listen to with the headphones on?
10. Anything off-limits.
