# Handoff: building "Still Compiling" locally

For a Claude Code session running on Aniruddha's machine, with Claude in Chrome connected. Read this file first, then `docs/TREATMENT.md` (the creative direction, approved), then `docs/PLAN-llm-3d-character.md` (the technical background: LLM backend, persona grounding, guardrails).

## Where things stand

- **Repo:** `Aniirudh/interactive-3d`, branch `claude/zealous-keller-gyqjv7`. The repo is **public**. Never commit voice recordings, raw generations or anything private. Keep them in git-ignored folders.
- **Today's site:** a Vite + React portfolio hero. An AI-video character (made in Google Flow) is composited on a canvas by `src/character/engine.ts`, a state machine of clips. `src/character/gaze.ts` follows the cursor with 414 pre-rendered head frames. Source clips are in `assets/clips/`, processed media in `public/media/`, and the processing pipeline in `scripts/*.py`.
- **Approved direction:** `docs/TREATMENT.md`. The site becomes a short documentary about Aniruddha, starring the character and narrated in his own cloned voice. The visitor can interrupt it at any moment to talk to him. Scripted lines are lip-synced. Live answers play over cutaway shots (over the shoulder, hands, cup, silhouette), so no real-time lip-sync is needed.
- **Nothing has been generated for the film yet**, apart from a voice check.

## Decisions already made

- **Voice:** ElevenLabs voice `Oct-6-sample`, voice_id `QgO2ARJyZQ6jd04o7A5y`. Confirmed as Aniruddha's professional clone. Model `eleven_v4`, which accepts inline tags like `[softly]` and `[pause]`.
- **Personal portfolio, all projects shown.**
- **Facts only.** No line, metric, skill or story may be invented. The script comes from Aniruddha's answers to the interview at the end of `docs/TREATMENT.md`. If an answer is missing, ask. Don't fill the gap.
- **Writing style for anything he reads:** short sentences, active voice, no filler, and none of these words: delve, testament, beacon, synergy, cutting-edge, passion, leverage, spearheaded.

## Tool roles (chosen to protect ElevenLabs credits)

| Need | Tool | Why |
|---|---|---|
| Character video shots | **Google Flow** in Chrome. Reuse the existing Flow project and its ingredients/references for this character | The original clips came from Flow, so the look stays consistent. Billed to Flow, not ElevenLabs |
| Stills, keyframes, storyboards, posters | **ChatGPT** image generation in Chrome | Cheap way to iterate. Get stills approved before any video is made |
| Narration in his voice | ElevenLabs (MCP) | Only ElevenLabs has his clone |
| Music and sound effects | ElevenLabs (MCP) | |
| Lip-sync of scripted talking shots | ElevenLabs `sync-lipsync-v3` (MCP), **or** generate talking shots in Flow, with his ElevenLabs audio as the reference where Flow supports it | Run `estimate_only` first. The price isn't known yet |
| Kling / Veo video via ElevenLabs | **Fallback only**, for a shot Flow can't make | ~5,090 credits per Kling shot and ~19,390 per Veo shot. Too expensive for the main film |
| Live credits, postcard, on-screen captions | Remotion (Player in the browser) | |
| Trailer and social cuts (16:9 + 9:16) | HyperFrames | |

## ElevenLabs budget: 108,569 credits at handoff

Rules:
1. **Call `estimate_only` before every generation.** Tell Aniruddha the price before anything over ~2,000 credits runs.
2. **Real costs run above the estimates.** A narration take was estimated at ~62 credits and billed at ~115. Plan with a margin.
3. **One take per narration line by default** (`generations_count: 1`). Redo only the lines that sound off. Aniruddha asked for credits to be protected; confirm this with him once at the start.
4. **Keep a reserve for after launch.** Every live answer on the site is TTS in his voice, about 60–115 credits for a few seconds, billed to this account. Agree a reserve with him and set per-visitor and per-day caps in the backend.

Rough split to propose to him (adjust after the estimates):

| Item | Credits |
|---|---|
| Narration, ~40 lines × 1 take + some redos | ~6,000–8,000 |
| Music, 3–5 tracks at ~1,650 each | ~5,000–8,000 |
| Sound effects | estimate first |
| Lip-sync | estimate first. Use it only on shots where the mouth is clearly visible |
| Reserve for live answers | the rest, as he decides |

Earlier price estimates left 4 empty flows in his ElevenLabs flows list, plus 1 flow holding the voice check. They're harmless; he can delete them.

## Order of work

1. **Interview.** Ask Aniruddha the 10 questions at the end of `docs/TREATMENT.md`. Voice notes are fine; transcribe them with ElevenLabs Scribe, or have him paste text. Save the answers to `persona/answers.md`. Ask him first whether that file should be git-ignored.
2. **Script.** Write the film script reel by reel from his answers and the real repo timeline below. Every factual line has to trace back to an answer or a repo. Get his sign-off on the script before generating anything.
3. **Shot list and storyboard.** One row per shot: reel, framing, action, line, cutaway or lip-synced. Make storyboard stills in ChatGPT, keeping the character on-model with `assets/headshot.png`, `assets/img1.png` and `assets/img2.png`. Get approval.
4. **Engineering, which costs no credits and can run in parallel with steps 1–3.**
   - Turn `engine.ts` into a shot director: reels, shots, cutaway pools.
   - Build the interrupt mechanic: freeze, duck the audio, the "Yeah?" shot, ask, answer over cutaways, resume.
   - Add the three entry modes: Watch / 60-second cut / Just the facts.
   - Use the existing clips in `public/media/` as stand-ins.
   - Keep the loader and the reduced-motion poster path.
5. **Proof scene: the cold open, fully finished.** Shots from Flow, his line from ElevenLabs, lip-sync, music, sound effects. Aniruddha judges the quality before the rest gets made.
6. **The rest of the film**, reel by reel, with approvals in between.
7. **Backend:** a Vercel function (a Vercel connector is linked to his account). It streams Claude answers grounded in `persona/`, then TTS in his voice, with rate limits and spend caps. See `PLAN-llm-3d-character.md` §6 for the persona rules and tools.
8. **Credits and postcard** (Remotion), the trailer (HyperFrames), and deploy.

## Facts available now (from his GitHub, by last push date)

Use these only as anchors for the timeline. Ask him what each one was before you describe it.
- **2021–22:** BNMIT-csi, Sample, four to-do apps (Todo-List-React-, Todo_list-react, Todo-Frontend-ReactJS, Todo-Backend), Full-Stack, FS, fsp, SOTD, startup, kalabhageerathi.github.io
- **2023:** tatva23, internship, trial/trial1, googleKeepClone + googleKeepAndroid, brewHaven, Backend-Newsfeed
- **2024:** netflixClone + netflixAndroid, reactNative-ChatBot, project-P, Aniirudh.github.io
- **2025:** landing-page, turiniq (fe/be, with Sanjeeva Chitlapalli), native-chat-app, LeadGen, fi-frontend/fi-backend, Hingemonium (fork)
- **2026:** RAG, finance-stock-tracker (fe/be, with circuit-geek), netflix (private), Sisters In Sweat (sis), Syntique Technologies, Four States, this site, an Instagram reel automation pipeline
- **Case-study facts** that already appear on syntique.vercel.app (his own published copy): Sisters In Sweat has 13,164 members (12,520 migrated, 644 new), 1,375 bookings since go-live, 1,398 Razorpay payments and 1,977 WhatsApp OTP logins, on Payload CMS, WATI, Razorpay and Zoho. Chitrapur Heritage Foundation runs on Strapi, Salesforce and Stripe, with 55 projects and 171 seva/donation options. Confirm with him that these are fine to repeat on a personal site.
- **Reference for the level of craft:** https://four-states.vercel.app (his own build).

## Quality bar (from his Four States brief)

- Animate only `transform` and `opacity` in the DOM. Measure frame times on a phone.
- No flat backgrounds.
- Sound is off until the visitor opts in, and never plays over speech.
- Captions for every spoken line. Keyboard and touch both work. Reduced motion keeps the poster and the text.
- Show music, voice and film drafts to him for approval before they replace anything final.
